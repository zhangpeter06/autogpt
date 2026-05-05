import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
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
