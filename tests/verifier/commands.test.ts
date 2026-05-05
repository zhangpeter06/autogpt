import { describe, expect, it } from "vitest";
import { runShellCommand } from "../../src/verifier/commands.js";

describe("runShellCommand", () => {
  it("times out long-running commands", async () => {
    const result = await runShellCommand(`"${process.execPath}" -e "setTimeout(() => {}, 1000)"`, process.cwd(), {
      timeoutMs: 50
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("timed out");
    expect(result.durationMs).toBeGreaterThanOrEqual(1);
  });
});
