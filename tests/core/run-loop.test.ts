import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { listClaudeSync } from "../../src/agents/claude-sync.js";
import { getRunDir } from "../../src/core/paths.js";
import { initProject, loadProjectState, setProjectGoal } from "../../src/core/project-state.js";
import { enqueueTask, listTasks } from "../../src/core/task-queue.js";
import { runOnce } from "../../src/core/run-loop.js";

describe("runOnce", () => {
  it("plans a task when the queue is empty", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "gptauto-run-plan-"));
    try {
      await initProject({ projectRoot });
      await setProjectGoal(projectRoot, "Build login");
      const result = await runOnce({
        projectRoot,
        executeCodex: async () => ({
          command: "codex",
          cwd: projectRoot,
          exitCode: 0,
          stdout: "done",
          stderr: "",
          durationMs: 1
        }),
        verify: async () => ({ ok: true, commands: [], risk: "low", findings: [] }),
        changedFiles: async () => []
      });
      expect(result.status).toBe("planned");
      expect((await listTasks(projectRoot)).queued.length).toBeGreaterThan(0);
      expect(await listClaudeSync(projectRoot)).toEqual([
        expect.objectContaining({
          type: "planning_fallback",
          summary: expect.stringContaining("Build login"),
          nextPlanUsedWithoutClaude: true
        })
      ]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("completes a queued task and writes run artifacts after successful verification", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "gptauto-run-complete-"));
    try {
      await initProject({ projectRoot });
      await setProjectGoal(projectRoot, "Build login");
      const task = await enqueueTask(projectRoot, {
        title: "Add login form",
        source: "user",
        risk: "medium",
        contextFiles: ["src/Login.tsx"],
        acceptance: ["Login form renders"]
      });

      const result = await runOnce({
        projectRoot,
        executeCodex: async () => ({
          command: "codex",
          cwd: projectRoot,
          exitCode: 0,
          stdout: "implemented",
          stderr: "",
          durationMs: 7
        }),
        verify: async () => ({ ok: true, commands: [], risk: "low", findings: [] }),
        changedFiles: async () => ["src/Login.tsx"]
      });

      expect(result.status).toBe("completed");
      expect(result.taskId).toBe(task.id);
      const state = await loadProjectState(projectRoot);
      expect(state.lastRunId).toBe(result.runId);
      expect(state.activeTaskId).toBeNull();

      const runDir = getRunDir(projectRoot, result.runId);
      await expect(readFile(join(runDir, "codex-output.md"), "utf8")).resolves.toContain("implemented");
      await expect(readFile(join(runDir, "verification.json"), "utf8")).resolves.toContain('"ok": true');
      await expect(readFile(join(runDir, "report.md"), "utf8")).resolves.toContain("Add login form");
      await expect(readFile(join(runDir, "handoff.md"), "utf8")).resolves.toContain(
        "## Last Completed Task\n\nAdd login form"
      );

      const tasks = await listTasks(projectRoot);
      expect(tasks.completed).toHaveLength(1);
      expect(tasks.queued).toHaveLength(0);
      expect(await listClaudeSync(projectRoot)).toEqual([
        expect.objectContaining({
          type: "execution_report",
          summary: expect.stringContaining("Add login form"),
          changedFiles: ["src/Login.tsx"],
          nextPlanUsedWithoutClaude: false
        })
      ]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("queues a repair task after failed verification", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "gptauto-run-repair-"));
    try {
      await initProject({ projectRoot });
      await setProjectGoal(projectRoot, "Build login");
      const task = await enqueueTask(projectRoot, {
        title: "Wire login submit",
        source: "user",
        risk: "medium",
        contextFiles: ["src/Login.tsx"],
        acceptance: ["Submit calls API"]
      });

      const result = await runOnce({
        projectRoot,
        executeCodex: async () => ({
          command: "codex",
          cwd: projectRoot,
          exitCode: 0,
          stdout: "attempted",
          stderr: "",
          durationMs: 5
        }),
        verify: async () => ({
          ok: false,
          commands: [],
          risk: "medium",
          findings: ["Command failed: npm test"]
        }),
        changedFiles: async () => ["src/Login.tsx"]
      });

      expect(result.status).toBe("repair_queued");
      expect(result.taskId).toBe(task.id);
      const tasks = await listTasks(projectRoot);
      expect(tasks.blocked).toEqual([
        expect.objectContaining({
          id: task.id,
          status: "blocked",
          blocker: "Verification failed; repair task queued"
        })
      ]);
      expect(tasks.queued).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: task.id,
            status: "running"
          })
        ])
      );
      expect(tasks.queued).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            status: "repair_queued",
            parentTaskId: task.id,
            title: "Repair: Wire login submit"
          })
        ])
      );
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("queues repair instead of completing when codex exits nonzero", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "gptauto-run-codex-fail-"));
    try {
      await initProject({ projectRoot });
      await setProjectGoal(projectRoot, "Build login");
      const task = await enqueueTask(projectRoot, {
        title: "Implement login validation",
        source: "user",
        risk: "medium",
        contextFiles: ["src/Login.tsx"],
        acceptance: ["Invalid logins show errors"]
      });

      const result = await runOnce({
        projectRoot,
        executeCodex: async () => ({
          command: "codex",
          cwd: projectRoot,
          exitCode: 1,
          stdout: "partial work",
          stderr: "failed",
          durationMs: 11
        }),
        verify: async () => ({ ok: true, commands: [], risk: "low", findings: [] }),
        changedFiles: async () => ["src/Login.tsx"]
      });

      expect(result.status).toBe("repair_queued");
      expect(result.taskId).toBe(task.id);
      const tasks = await listTasks(projectRoot);
      expect(tasks.completed).toHaveLength(0);
      expect(tasks.blocked).toEqual([
        expect.objectContaining({
          id: task.id,
          blocker: "Verification failed; repair task queued"
        })
      ]);
      expect(tasks.queued).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            status: "repair_queued",
            parentTaskId: task.id,
            acceptance: ["Fix verification failure: Codex command failed with exit code 1"]
          })
        ])
      );

      const runDir = getRunDir(projectRoot, result.runId);
      await expect(readFile(join(runDir, "codex-output.md"), "utf8")).resolves.toContain("Exit Code\n\n1");
      await expect(readFile(join(runDir, "report.md"), "utf8")).resolves.toContain(
        "Codex command failed with exit code 1"
      );
      await expect(readFile(join(runDir, "handoff.md"), "utf8")).resolves.toContain("Failed");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("blocks and clears active task when codex execution throws", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "gptauto-run-throw-"));
    try {
      await initProject({ projectRoot });
      await setProjectGoal(projectRoot, "Build login");
      const task = await enqueueTask(projectRoot, {
        title: "Generate login markup",
        source: "user",
        risk: "medium",
        contextFiles: ["src/Login.tsx"],
        acceptance: ["Markup is generated"]
      });

      const result = await runOnce({
        projectRoot,
        executeCodex: async () => {
          throw new Error("codex crashed");
        },
        verify: async () => ({ ok: true, commands: [], risk: "low", findings: [] }),
        changedFiles: async () => ["src/Login.tsx"]
      });

      expect(result.status).toBe("blocked");
      expect(result.taskId).toBe(task.id);
      const state = await loadProjectState(projectRoot);
      expect(state.activeTaskId).toBeNull();
      expect(state.lastRunId).toBe(result.runId);

      const tasks = await listTasks(projectRoot);
      expect(tasks.queued).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: task.id,
            status: "running"
          })
        ])
      );
      expect(tasks.blocked).toEqual([
        expect.objectContaining({
          id: task.id,
          blocker: "Run loop failed: codex crashed"
        })
      ]);

      const runDir = getRunDir(projectRoot, result.runId);
      await expect(readFile(join(runDir, "report.md"), "utf8")).resolves.toContain("Run loop failed: codex crashed");
      await expect(readFile(join(runDir, "handoff.md"), "utf8")).resolves.toContain("Run loop failed: codex crashed");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("blocks critical tasks before codex execution", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "gptauto-run-critical-approval-"));
    try {
      await initProject({ projectRoot });
      await setProjectGoal(projectRoot, "Build login");
      const task = await enqueueTask(projectRoot, {
        title: "Rewrite auth boundary",
        source: "user",
        risk: "critical",
        contextFiles: ["src/auth.ts"],
        acceptance: ["Auth boundary is reviewed"]
      });
      let codexCalled = false;

      const result = await runOnce({
        projectRoot,
        executeCodex: async () => {
          codexCalled = true;
          throw new Error("codex must not run");
        },
        verify: async () => ({ ok: true, commands: [], risk: "low", findings: [] }),
        changedFiles: async () => ["src/auth.ts"]
      });

      expect(result).toMatchObject({
        status: "blocked",
        taskId: task.id,
        reason: "Task requires approval before execution"
      });
      expect(codexCalled).toBe(false);
      const state = await loadProjectState(projectRoot);
      expect(state.activeTaskId).toBeNull();

      const tasks = await listTasks(projectRoot);
      expect(tasks.blocked).toEqual([
        expect.objectContaining({
          id: task.id,
          status: "blocked",
          blocker: "Task requires approval before execution"
        })
      ]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("blocks queued tasks before codex when existing user changes are present", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "gptauto-run-dirty-"));
    try {
      await initProject({ projectRoot });
      await setProjectGoal(projectRoot, "Build login");
      const task = await enqueueTask(projectRoot, {
        title: "Add login form",
        source: "user",
        risk: "medium",
        contextFiles: ["src/Login.tsx"],
        acceptance: ["Login form renders"]
      });
      let codexCalled = false;

      const result = await runOnce({
        projectRoot,
        preflightChangedFiles: async () => ["src/App.tsx", ".gptauto/tasks/queue.jsonl"],
        executeCodex: async () => {
          codexCalled = true;
          throw new Error("codex must not run");
        },
        verify: async () => ({ ok: true, commands: [], risk: "low", findings: [] }),
        changedFiles: async () => []
      });

      expect(result).toMatchObject({
        status: "blocked",
        taskId: task.id
      });
      expect(result.reason).toContain("Uncommitted worktree changes require approval");
      expect(result.reason).toContain("src/App.tsx");
      expect(result.reason).not.toContain(".gptauto");
      expect(codexCalled).toBe(false);
      const state = await loadProjectState(projectRoot);
      expect(state.activeTaskId).toBeNull();
      const tasks = await listTasks(projectRoot);
      expect(tasks.blocked).toEqual([
        expect.objectContaining({
          id: task.id,
          blocker: expect.stringContaining("Uncommitted worktree changes require approval")
        })
      ]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("blocks concurrent runs with a run lock", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "gptauto-run-lock-"));
    try {
      await initProject({ projectRoot });
      await setProjectGoal(projectRoot, "Build login");
      await enqueueTask(projectRoot, {
        title: "Add login form",
        source: "user",
        risk: "medium",
        contextFiles: ["src/Login.tsx"],
        acceptance: ["Login form renders"]
      });

      let releaseCodex!: () => void;
      let firstRun!: Promise<Awaited<ReturnType<typeof runOnce>>>;
      const codexStarted = new Promise<void>((resolve) => {
        firstRun = runOnce({
          projectRoot,
          preflightChangedFiles: async () => [],
          executeCodex: async () => {
            resolve();
            await new Promise<void>((release) => {
              releaseCodex = release;
            });
            return {
              command: "codex",
              cwd: projectRoot,
              exitCode: 0,
              stdout: "implemented",
              stderr: "",
              durationMs: 1
            };
          },
          verify: async () => ({ ok: true, commands: [], risk: "low", findings: [] }),
          changedFiles: async () => ["src/Login.tsx"]
        });
      });

      await codexStarted;
      const secondResult = await runOnce({
        projectRoot,
        preflightChangedFiles: async () => [],
        executeCodex: async () => {
          throw new Error("second run must not execute codex");
        },
        verify: async () => ({ ok: true, commands: [], risk: "low", findings: [] }),
        changedFiles: async () => []
      });
      releaseCodex();
      await firstRun;

      expect(secondResult).toEqual({
        status: "blocked",
        reason: "Another gptauto run is already active"
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("blocks the running task after critical verification risk", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "gptauto-run-block-"));
    try {
      await initProject({ projectRoot });
      await setProjectGoal(projectRoot, "Build login");
      const task = await enqueueTask(projectRoot, {
        title: "Change auth storage",
        source: "user",
        risk: "high",
        contextFiles: ["src/auth.ts"],
        acceptance: ["Auth remains secure"]
      });

      const result = await runOnce({
        projectRoot,
        executeCodex: async () => ({
          command: "codex",
          cwd: projectRoot,
          exitCode: 0,
          stdout: "changed",
          stderr: "",
          durationMs: 9
        }),
        verify: async () => ({
          ok: false,
          commands: [],
          risk: "critical",
          findings: ["Critical files changed"]
        }),
        changedFiles: async () => ["src/auth.ts"]
      });

      expect(result.status).toBe("blocked");
      expect(result.taskId).toBe(task.id);
      const tasks = await listTasks(projectRoot);
      expect(tasks.blocked).toEqual([
        expect.objectContaining({
          id: task.id,
          status: "blocked",
          blocker: "Critical verification risk"
        })
      ]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
