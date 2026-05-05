import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getGptautoPaths } from "../../src/core/paths.js";

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
