import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { initProject } from "../../src/core/project-state.js";
import {
  blockTask,
  completeTask,
  enqueueTask,
  listTasks,
  nextQueuedTask,
  updateTaskStatus
} from "../../src/core/task-queue.js";

describe("task queue", () => {
  it("enqueues and reads the next queued task", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "gptauto-queue-"));
    try {
      await initProject({ projectRoot });
      const task = await enqueueTask(projectRoot, {
        title: "Add login form",
        source: "user",
        risk: "medium",
        contextFiles: ["src/Login.tsx"],
        acceptance: ["Login form renders"]
      });
      expect(task.status).toBe("queued");
      await expect(nextQueuedTask(projectRoot)).resolves.toMatchObject({ id: task.id, title: "Add login form" });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("moves completed and blocked tasks to their audit logs", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "gptauto-queue-move-"));
    try {
      await initProject({ projectRoot });
      const task = await enqueueTask(projectRoot, {
        title: "Run tests",
        source: "local",
        risk: "low",
        contextFiles: [],
        acceptance: ["Tests pass"]
      });
      await updateTaskStatus(projectRoot, task.id, "running");
      await completeTask(projectRoot, task.id);
      await blockTask(projectRoot, { ...task, id: "manual-block" }, "Needs human review");
      const tasks = await listTasks(projectRoot);
      expect(tasks.completed).toHaveLength(1);
      expect(tasks.blocked).toHaveLength(1);
      expect(tasks.blocked[0].blocker).toBe("Needs human review");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("uses the latest queue record when selecting queued tasks", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "gptauto-queue-compact-"));
    try {
      await initProject({ projectRoot });
      const task = await enqueueTask(projectRoot, {
        title: "Ship a fix",
        source: "codex",
        risk: "high",
        contextFiles: ["src/fix.ts"],
        acceptance: ["Regression stays fixed"]
      });
      await updateTaskStatus(projectRoot, task.id, "running");
      await completeTask(projectRoot, task.id);

      await expect(nextQueuedTask(projectRoot)).resolves.toBeNull();
      await expect(listTasks(projectRoot)).resolves.toMatchObject({ queued: [] });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
