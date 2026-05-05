import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { initProject } from "../../src/core/project-state.js";
import { writeHandoff } from "../../src/core/handoff.js";

describe("writeHandoff", () => {
  it("writes continuation-focused context", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "gptauto-handoff-"));
    try {
      await initProject({ projectRoot });
      const path = await writeHandoff(projectRoot, "run_2", {
        goal: "Build the app",
        currentTask: "Add login",
        lastCompletedTask: "Set up project state",
        changedFiles: ["src/Login.tsx"],
        verification: "Tests passed",
        decisions: ["Used Vitest"],
        blockers: [],
        nextAction: "Pick the next queued task"
      });
      const content = await readFile(path, "utf8");
      expect(content).toContain("# Handoff: run_2");
      expect(content).toContain("Build the app");
      expect(content).toContain("## Last Completed Task");
      expect(content).toContain("Set up project state");
      expect(content).toContain("Pick the next queued task");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("writes a placeholder when no completed task is recorded", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "gptauto-handoff-"));
    try {
      await initProject({ projectRoot });
      const path = await writeHandoff(projectRoot, "run_3", {
        goal: "Build the app",
        currentTask: "Add profile",
        lastCompletedTask: null,
        changedFiles: [],
        verification: "Not run",
        decisions: [],
        blockers: [],
        nextAction: "Run the next task"
      });
      const content = await readFile(path, "utf8");
      expect(content).toContain("## Last Completed Task");
      expect(content).toContain("No completed task recorded");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
