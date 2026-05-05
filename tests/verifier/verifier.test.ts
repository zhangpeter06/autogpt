import { describe, expect, it } from "vitest";
import { verifyProject } from "../../src/verifier/verifier.js";

describe("verifyProject", () => {
  it("returns ok when commands succeed", async () => {
    const result = await verifyProject({
      projectRoot: "E:/project",
      commands: ["npm test"],
      changedFiles: ["src/app.ts"],
      runner: async (command, cwd) => ({
        command,
        cwd,
        exitCode: 0,
        stdout: "pass",
        stderr: "",
        durationMs: 1
      })
    });

    expect(result.ok).toBe(true);
    expect(result.risk).toBe("medium");
  });

  it("returns failed findings when a command fails", async () => {
    const result = await verifyProject({
      projectRoot: "E:/project",
      commands: ["npm test"],
      changedFiles: ["src/app.ts"],
      runner: async (command, cwd) => ({
        command,
        cwd,
        exitCode: 1,
        stdout: "",
        stderr: "failed",
        durationMs: 1
      })
    });

    expect(result.ok).toBe(false);
    expect(result.findings[0]).toContain("failed");
  });

  it("runs all commands and reports a later failure", async () => {
    const commandsRun: string[] = [];

    const result = await verifyProject({
      projectRoot: "E:/project",
      commands: ["npm run lint", "npm test"],
      changedFiles: ["src/app.ts"],
      runner: async (command, cwd) => {
        commandsRun.push(command);
        return {
          command,
          cwd,
          exitCode: command === "npm test" ? 1 : 0,
          stdout: "",
          stderr: command === "npm test" ? "test failed" : "",
          durationMs: 1
        };
      }
    });

    expect(commandsRun).toEqual(["npm run lint", "npm test"]);
    expect(result.ok).toBe(false);
    expect(result.commands).toHaveLength(2);
    expect(result.findings).toContain("test failed");
  });

  it("classifies critical changed files even when commands succeed", async () => {
    const result = await verifyProject({
      projectRoot: "E:/project",
      commands: ["npm test"],
      changedFiles: [".env"],
      runner: async (command, cwd) => ({
        command,
        cwd,
        exitCode: 0,
        stdout: "pass",
        stderr: "",
        durationMs: 1
      })
    });

    expect(result.ok).toBe(true);
    expect(result.risk).toBe("critical");
  });
});
