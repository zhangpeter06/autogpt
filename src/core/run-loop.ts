import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runCodexTask } from "../agents/codex-cli.js";
import { planFromGoal } from "../agents/local-planner.js";
import { getChangedFiles } from "../verifier/git.js";
import { verifyProject } from "../verifier/verifier.js";
import { writeHandoff } from "./handoff.js";
import { getRunDir } from "./paths.js";
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
import type { CommandResult, Task, VerificationResult } from "./types.js";

export interface RunOnceInput {
  projectRoot: string;
  executeCodex?: (task: Task) => Promise<CommandResult>;
  verify?: (input: { commands: string[]; changedFiles: string[] }) => Promise<VerificationResult>;
  changedFiles?: () => Promise<string[]>;
}

export type RunOnceResult =
  | { status: "planned"; taskCount: number }
  | { status: "completed"; runId: string; taskId: string }
  | { status: "repair_queued"; runId: string; taskId: string; repairTaskId: string }
  | { status: "blocked"; reason: string; runId?: string; taskId?: string };

export async function runOnce(input: RunOnceInput): Promise<RunOnceResult> {
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
    return { status: "planned", taskCount: plannedTasks.length };
  }

  const running = await updateTaskStatus(projectRoot, queuedTask.id, "running");
  await saveProjectState(projectRoot, {
    ...state,
    activeTaskId: running.id
  });

  const runId = `run_${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const runDir = getRunDir(projectRoot, runId);
  await mkdir(runDir, { recursive: true });

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
  const verify =
    input.verify ??
    ((verifyInput: { commands: string[]; changedFiles: string[] }) =>
      verifyProject({
        projectRoot,
        commands: verifyInput.commands,
        changedFiles: verifyInput.changedFiles
      }));
  const verification = await verify({ commands, changedFiles });
  await writeFile(join(runDir, "verification.json"), `${JSON.stringify(verification, null, 2)}\n`, "utf8");

  const status = verification.risk === "critical" ? "blocked" : verification.ok ? "completed" : "repair_queued";
  const reportPath = await writeRunReport(projectRoot, runId, {
    taskTitle: running.title,
    status,
    changedFiles,
    verificationOk: verification.ok,
    findings: verification.findings
  });
  await writeHandoff(projectRoot, runId, {
    goal: state.goal ?? "No project goal is configured",
    currentTask: running.title,
    lastCompletedTask: status === "completed" ? running.title : null,
    changedFiles,
    verification: verification.ok ? "Passed" : "Failed",
    decisions: [`Run report written to ${reportPath}`],
    blockers: status === "blocked" ? ["Critical verification risk"] : [],
    nextAction: status === "completed" ? "Pick the next queued task" : "Inspect verification findings and repair"
  });

  await saveProjectState(projectRoot, {
    ...state,
    activeTaskId: null,
    lastRunId: runId
  });

  if (verification.risk === "critical") {
    await blockTask(projectRoot, running, "Critical verification risk");
    return { status: "blocked", reason: "Critical verification risk", runId, taskId: running.id };
  }

  if (verification.ok) {
    await completeTask(projectRoot, running.id);
    return { status: "completed", runId, taskId: running.id };
  }

  const repairTask = await createRepairTask(projectRoot, running, verification.findings.join("; ") || "Verification failed");
  return { status: "repair_queued", runId, taskId: running.id, repairTaskId: repairTask.id };
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
