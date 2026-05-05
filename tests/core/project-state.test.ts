import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { getGptautoPaths } from "../../src/core/paths.js";
import {
  initProject,
  loadProjectConfig,
  loadProjectState,
  saveProjectState,
  setProjectGoal
} from "../../src/core/project-state.js";

describe("getGptautoPaths", () => {
  it("derives all state paths under the project .gptauto directory", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "gptauto-paths-"));
    try {
      const paths = getGptautoPaths(projectRoot);
      expect(paths.root).toBe(join(projectRoot, ".gptauto"));
      expect(paths.config).toBe(join(projectRoot, ".gptauto", "config.json"));
      expect(paths.state).toBe(join(projectRoot, ".gptauto", "state.json"));
      expect(paths.taskQueue).toBe(join(projectRoot, ".gptauto", "tasks", "queue.jsonl"));
      expect(paths.completedTasks).toBe(join(projectRoot, ".gptauto", "tasks", "completed.jsonl"));
      expect(paths.blockedTasks).toBe(join(projectRoot, ".gptauto", "tasks", "blocked.jsonl"));
      expect(paths.decisions).toBe(join(projectRoot, ".gptauto", "decisions", "decisions.jsonl"));
      expect(paths.claudeSync).toBe(join(projectRoot, ".gptauto", "reports", "claude-sync.jsonl"));
      expect(paths.runLock).toBe(join(projectRoot, ".gptauto", "locks", "run.lock"));
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});

describe("initProject", () => {
  it("creates the gptauto directory layout and default files", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "gptauto-init-"));
    try {
      await initProject({ projectRoot, aggression: "aggressive" });
      const paths = getGptautoPaths(projectRoot);
      const config = await loadProjectConfig(projectRoot);
      const state = await loadProjectState(projectRoot);
      expect(config.projectRoot).toBe(projectRoot);
      expect(config.aggression).toBe("aggressive");
      expect(state.version).toBe(1);
      expect(state.goal).toBeNull();
      await expect(readFile(paths.taskQueue, "utf8")).resolves.toBe("");
      await expect(readFile(paths.completedTasks, "utf8")).resolves.toBe("");
      await expect(readFile(paths.blockedTasks, "utf8")).resolves.toBe("");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("preserves recovery state when init is rerun", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "gptauto-init-preserve-"));
    try {
      await initProject({ projectRoot, aggression: "balanced" });
      const withGoal = await setProjectGoal(projectRoot, "Keep building");
      await saveProjectState(projectRoot, {
        ...withGoal,
        activeTaskId: "task_123",
        lastRunId: "run_123"
      });

      await initProject({ projectRoot, aggression: "aggressive" });

      const config = await loadProjectConfig(projectRoot);
      const state = await loadProjectState(projectRoot);
      expect(config.aggression).toBe("aggressive");
      expect(state.goal).toBe("Keep building");
      expect(state.activeTaskId).toBe("task_123");
      expect(state.lastRunId).toBe("run_123");
      expect(state.createdAt).toBe(withGoal.createdAt);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
