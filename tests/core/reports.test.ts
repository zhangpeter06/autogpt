import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { initProject } from "../../src/core/project-state.js";
import { writeRunReport } from "../../src/core/reports.js";

describe("writeRunReport", () => {
  it("writes a markdown run report", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "gptauto-report-"));
    try {
      await initProject({ projectRoot });
      const path = await writeRunReport(projectRoot, "run_1", {
        taskTitle: "Add login",
        status: "completed",
        changedFiles: ["src/Login.tsx"],
        verificationOk: true,
        findings: []
      });
      const content = await readFile(path, "utf8");
      expect(content).toContain("# Run Report: run_1");
      expect(content).toContain("Add login");
      expect(content).toContain("src/Login.tsx");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
