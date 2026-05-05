import { describe, expect, it } from "vitest";
import { runCodexTask } from "../../src/agents/codex-cli.js";

describe("runCodexTask", () => {
  it("passes the generated prompt to the injected runner", async () => {
    const calls: string[] = [];
    let prompt = "";

    const result = await runCodexTask({
      projectRoot: "E:/project",
      codexCommand: "codex",
      task: {
        id: "task_1",
        project: "E:/project",
        title: "Add login",
        source: "user",
        status: "running",
        risk: "low",
        attempts: 1,
        maxAttempts: 3,
        requiresApproval: false,
        contextFiles: ["src/Login.tsx"],
        acceptance: ["Login renders"],
        createdAt: "2026-05-05T00:00:00.000Z",
        updatedAt: "2026-05-05T00:00:00.000Z"
      },
      runner: async (command, args, cwd, input) => {
        calls.push(`${command} ${args.join(" ")}`);
        prompt = input;
        return { command, cwd, exitCode: 0, stdout: "done", stderr: "", durationMs: 1 };
      }
    });

    expect(calls[0]).toContain("codex");
    expect(prompt).toContain("Add login");
    expect(prompt).toContain("Login renders");
    expect(prompt).toContain("src/Login.tsx");
    expect(result.stdout).toBe("done");
  });
});
