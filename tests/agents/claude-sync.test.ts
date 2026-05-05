import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendClaudeSync, listClaudeSync } from "../../src/agents/claude-sync.js";
import { initProject } from "../../src/core/project-state.js";

describe("claude sync queue", () => {
  it("defaults automatic question answers to an empty array", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "gptauto-claude-sync-"));
    try {
      await initProject({ projectRoot });

      await appendClaudeSync(projectRoot, {
        type: "planning_fallback",
        summary: "Used local plan while Claude was unavailable",
        changedFiles: [],
        nextPlanUsedWithoutClaude: true
      });

      const records = await listClaudeSync(projectRoot);
      expect(records).toHaveLength(1);
      expect(records[0]?.questionsAnsweredAutomatically).toEqual([]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("persists automatic question answer details", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "gptauto-claude-sync-"));
    try {
      await initProject({ projectRoot });

      await appendClaudeSync(projectRoot, {
        type: "execution_report",
        summary: "Completed auth validation",
        changedFiles: ["src/auth/Login.tsx"],
        questionsAnsweredAutomatically: [
          {
            question: "Use inline validation or schema validation?",
            choice: "schema validation",
            reason: "Existing project already uses zod."
          }
        ],
        nextPlanUsedWithoutClaude: true
      });

      const records = await listClaudeSync(projectRoot);
      expect(records).toHaveLength(1);
      expect(records[0]?.questionsAnsweredAutomatically).toEqual([
        {
          question: "Use inline validation or schema validation?",
          choice: "schema validation",
          reason: "Existing project already uses zod."
        }
      ]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
