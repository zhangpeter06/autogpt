import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chooseOption, listDecisions } from "../../src/core/decisions.js";
import { initProject } from "../../src/core/project-state.js";

describe("decision engine", () => {
  it("auto-approves reversible high risk choices in aggressive mode", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "gptauto-decisions-"));
    try {
      await initProject({ projectRoot, aggression: "aggressive" });
      const decision = await chooseOption(projectRoot, {
        taskId: "task_1",
        question: "Use Vitest or Jest?",
        options: ["Vitest", "Jest"],
        recommended: "Vitest",
        risk: "high",
        reversible: true,
        reason: "The project already uses Vite."
      });
      expect(decision.choice).toBe("Vitest");
      expect(decision.approvedBy).toBe("policy:auto-aggressive");
      await expect(listDecisions(projectRoot)).resolves.toHaveLength(1);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("requires approval for critical choices and does not append them", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "gptauto-decisions-"));
    try {
      await initProject({ projectRoot, aggression: "aggressive" });
      await expect(
        chooseOption(projectRoot, {
          taskId: "task_2",
          question: "Rotate production credentials?",
          options: ["Rotate now", "Defer"],
          recommended: "Rotate now",
          risk: "critical",
          reversible: false,
          reason: "Credentials may have leaked."
        })
      ).rejects.toThrow("Decision requires human approval");
      await expect(listDecisions(projectRoot)).resolves.toHaveLength(0);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("falls back to the first option when the recommendation is not available", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "gptauto-decisions-"));
    try {
      await initProject({ projectRoot });
      const decision = await chooseOption(projectRoot, {
        taskId: null,
        question: "Which package manager?",
        options: ["npm", "pnpm"],
        recommended: "yarn",
        risk: "medium",
        reversible: true,
        reason: "Use an available package manager."
      });
      expect(decision.choice).toBe("npm");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
