import { mkdir, open, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { appendClaudeSync } from "../agents/claude-sync.js";
import { runCodexTask } from "../agents/codex-cli.js";
import { planFromGoal } from "../agents/local-planner.js";
import { getChangedFiles } from "../verifier/git.js";
import { verifyProject } from "../verifier/verifier.js";
import { writeHandoff } from "./handoff.js";
import { getGptautoPaths, getRunDir } from "./paths.js";
import { loadProjectConfig, loadProjectState, saveProjectState } from "./project-state.js";
import { writeRunReport } from "./reports.js";
import {
  blockTask,
  completeTask,
  createRepairTask,
  enqueueTask,
  nextQueuedTask,
  updateTaskStatus
} from "./task-queue.js";
import type { CommandResult, RiskLevel, Task, VerificationResult } from "./types.js";

export interface RunOnceInput {
  projectRoot: string;
  executeCodex?: (task: Task) => Promise<CommandResult>;
  verify?: (input: { commands: string[]; changedFiles: string[] }) => Promise<VerificationResult>;
  preflightChangedFiles?: () => Promise<string[]>;
  changedFiles?: () => Promise<string[]>;
}

export type RunOnceResult =
  | { status: "planned"; taskCount: number }
  | { status: "completed"; runId: string; taskId: string }
  | { status: "repair_queued"; runId: string; taskId: string; repairTaskId: string }
  | { status: "blocked"; reason: string; runId?: string; taskId?: string };

export async function runOnce(input: RunOnceInput): Promise<RunOnceResult> {
  return withRunLock(input.projectRoot, () => runOnceUnlocked(input));
}

async function runOnceUnlocked(input: RunOnceInput): Promise<RunOnceResult> {
  const { projectRoot } = input;
  const config = await loadProjectConfig(projectRoot);
  const state = await loadProjectState(projectRoot);
  const queuedTask = await nextQueuedTask(projectRoot);

  if (!queuedTask) {
    if (!state.goal?.trim()) {
      return { status: "blocked", reason: "No project goal is configured" };
    }

    const plannedTasks = planFromGoal(state.goal);
    for (const task of plannedTasks) {
      await enqueueTask(projectRoot, task);
    }
    await appendClaudeSync(projectRoot, {
      type: "planning_fallback",
      summary: `Local planner created ${plannedTasks.length} task(s) for goal: ${state.goal}`,
      changedFiles: [],
      nextPlanUsedWithoutClaude: true
    });
    return { status: "planned", taskCount: plannedTasks.length };
  }

  if (queuedTask.requiresApproval || queuedTask.risk === "critical") {
    const reason = "Task requires approval before execution";
    await saveProjectState(projectRoot, {
      ...state,
      activeTaskId: null
    });
    await blockTask(projectRoot, queuedTask, reason);
    return { status: "blocked", reason, taskId: queuedTask.id };
  }

  const preflightChangedFiles = await (input.preflightChangedFiles ?? (() => getChangedFiles(projectRoot)))();
  const userChangedFiles = preflightChangedFiles.filter(isUserWorktreeChange);
  if (userChangedFiles.length > 0) {
    const reason = `Uncommitted worktree changes require approval before execution: ${formatFileList(userChangedFiles)}`;
    await saveProjectState(projectRoot, {
      ...state,
      activeTaskId: null
    });
    await blockTask(projectRoot, queuedTask, reason);
    return { status: "blocked", reason, taskId: queuedTask.id };
  }

  const running = await updateTaskStatus(projectRoot, queuedTask.id, "running");
  await saveProjectState(projectRoot, {
    ...state,
    activeTaskId: running.id
  });

  const runId = `run_${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const runDir = getRunDir(projectRoot, runId);
  await mkdir(runDir, { recursive: true });

  try {
    const executeCodex =
      input.executeCodex ??
      ((task: Task) =>
        runCodexTask({
          projectRoot,
          codexCommand: config.codexCommand,
          task
        }));
    const codexResult = await executeCodex(running);
    await writeFile(join(runDir, "codex-output.md"), formatCodexOutput(codexResult), "utf8");

    const changedFiles = await (input.changedFiles ?? (() => getChangedFiles(projectRoot)))();
    const commands = [...config.testCommands, ...config.lintCommands, ...config.typecheckCommands];
    const verification =
      codexResult.exitCode === 0
        ? await runVerifier(input, projectRoot, commands, changedFiles)
        : failedVerification(`Codex command failed with exit code ${codexResult.exitCode ?? "null"}`, running.risk);

    return finalizeRun({
      projectRoot,
      state,
      runId,
      task: running,
      changedFiles,
      verification
    });
  } catch (error) {
    const reason = `Run loop failed: ${errorMessage(error)}`;
    await safeWriteFailureArtifacts({
      projectRoot,
      state,
      runId,
      task: running,
      reason
    });
    await clearActiveRun(projectRoot, state, runId);
    await blockTask(projectRoot, running, reason);
    return { status: "blocked", reason, runId, taskId: running.id };
  }
}

async function withRunLock(projectRoot: string, action: () => Promise<RunOnceResult>): Promise<RunOnceResult> {
  const lockPath = getGptautoPaths(projectRoot).runLock;
  await mkdir(dirname(lockPath), { recursive: true });

  let handle;
  try {
    handle = await open(lockPath, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return { status: "blocked", reason: "Another gptauto run is already active" };
    }
    throw error;
  }

  try {
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`, "utf8");
    return await action();
  } finally {
    await handle.close();
    await rm(lockPath, { force: true });
  }
}

async function runVerifier(
  input: RunOnceInput,
  projectRoot: string,
  commands: string[],
  changedFiles: string[]
): Promise<VerificationResult> {
  const verify =
    input.verify ??
    ((verifyInput: { commands: string[]; changedFiles: string[] }) =>
      verifyProject({
        projectRoot,
        commands: verifyInput.commands,
        changedFiles: verifyInput.changedFiles
      }));
  return verify({ commands, changedFiles });
}

async function finalizeRun(input: {
  projectRoot: string;
  state: Awaited<ReturnType<typeof loadProjectState>>;
  runId: string;
  task: Task;
  changedFiles: string[];
  verification: VerificationResult;
}): Promise<RunOnceResult> {
  const { projectRoot, state, runId, task, changedFiles, verification } = input;
  await writeFile(join(getRunDir(projectRoot, runId), "verification.json"), `${JSON.stringify(verification, null, 2)}\n`, "utf8");

  const status = verification.risk === "critical" ? "blocked" : verification.ok ? "completed" : "repair_queued";
  await writeRunArtifacts({
    projectRoot,
    state,
    runId,
    task,
    status,
    changedFiles,
    verification,
    blockers: status === "blocked" ? ["Critical verification risk"] : []
  });
  await clearActiveRun(projectRoot, state, runId);

  if (verification.risk === "critical") {
    await blockTask(projectRoot, task, "Critical verification risk");
    return { status: "blocked", reason: "Critical verification risk", runId, taskId: task.id };
  }

  if (verification.ok) {
    await completeTask(projectRoot, task.id);
    return { status: "completed", runId, taskId: task.id };
  }

  await blockTask(projectRoot, task, "Verification failed; repair task queued");
  const repairTask = await createRepairTask(projectRoot, task, verification.findings.join("; ") || "Verification failed");
  return { status: "repair_queued", runId, taskId: task.id, repairTaskId: repairTask.id };
}

async function writeRunArtifacts(input: {
  projectRoot: string;
  state: Awaited<ReturnType<typeof loadProjectState>>;
  runId: string;
  task: Task;
  status: "completed" | "repair_queued" | "blocked";
  changedFiles: string[];
  verification: VerificationResult;
  blockers: string[];
}): Promise<void> {
  const reportPath = await writeRunReport(input.projectRoot, input.runId, {
    taskTitle: input.task.title,
    status: input.status,
    changedFiles: input.changedFiles,
    verificationOk: input.verification.ok,
    findings: input.verification.findings
  });
  await writeHandoff(input.projectRoot, input.runId, {
    goal: input.state.goal ?? "No project goal is configured",
    currentTask: input.task.title,
    lastCompletedTask: input.status === "completed" ? input.task.title : null,
    changedFiles: input.changedFiles,
    verification: input.verification.ok ? "Passed" : `Failed: ${input.verification.findings.join("; ")}`,
    decisions: [`Run report written to ${reportPath}`],
    blockers: input.blockers,
    nextAction: input.status === "completed" ? "Pick the next queued task" : "Inspect verification findings and repair"
  });
  await appendClaudeSync(input.projectRoot, {
    type: "execution_report",
    summary: `${input.status}: ${input.task.title}`,
    changedFiles: input.changedFiles,
    nextPlanUsedWithoutClaude: false
  });
}

async function safeWriteFailureArtifacts(input: {
  projectRoot: string;
  state: Awaited<ReturnType<typeof loadProjectState>>;
  runId: string;
  task: Task;
  reason: string;
}): Promise<void> {
  const verification = failedVerification(input.reason, "critical");
  try {
    await writeFile(
      join(getRunDir(input.projectRoot, input.runId), "verification.json"),
      `${JSON.stringify(verification, null, 2)}\n`,
      "utf8"
    );
    await writeRunArtifacts({
      projectRoot: input.projectRoot,
      state: input.state,
      runId: input.runId,
      task: input.task,
      status: "blocked",
      changedFiles: [],
      verification,
      blockers: [input.reason]
    });
  } catch {
    // State cleanup and task blocking still need to happen if artifact recovery fails.
  }
}

async function clearActiveRun(
  projectRoot: string,
  state: Awaited<ReturnType<typeof loadProjectState>>,
  runId: string
): Promise<void> {
  await saveProjectState(projectRoot, {
    ...state,
    activeTaskId: null,
    lastRunId: runId
  });
}

function failedVerification(finding: string, risk: RiskLevel): VerificationResult {
  return {
    ok: false,
    commands: [],
    risk,
    findings: [finding]
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isUserWorktreeChange(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  return normalized !== ".gptauto" && !normalized.startsWith(".gptauto/");
}

function formatFileList(filePaths: string[]): string {
  const visibleFiles = filePaths.slice(0, 5).join(", ");
  return filePaths.length > 5 ? `${visibleFiles}, and ${filePaths.length - 5} more` : visibleFiles;
}

function formatCodexOutput(result: CommandResult): string {
  return `# Codex Output

## Command

${result.command}

## Exit Code

${result.exitCode ?? "null"}

## Duration

${result.durationMs}ms

## Stdout

\`\`\`
${result.stdout}
\`\`\`

## Stderr

\`\`\`
${result.stderr}
\`\`\`
`;
}
