import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runShellCommand } from "../../src/verifier/commands.js";

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe("runShellCommand", () => {
  it("times out and stops the underlying command", async () => {
    const testRoot = await mkdtemp(join(tmpdir(), "gptauto-command-"));
    const markerPath = join(testRoot, "marker.txt");
    const scriptPath = join(testRoot, "write-marker-after-timeout.cjs");
    await writeFile(
      scriptPath,
      [
        "const { writeFileSync } = require('node:fs');",
        "const markerPath = process.argv[2];",
        "setTimeout(() => writeFileSync(markerPath, 'still running'), 1000);",
        "setTimeout(() => {}, 2000);"
      ].join("\n")
    );

    const result = await runShellCommand(`"${process.execPath}" "${scriptPath}" "${markerPath}"`, process.cwd(), {
      timeoutMs: 50
    });
    await new Promise((resolve) => setTimeout(resolve, 1300));

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("timed out");
    expect(result.durationMs).toBeGreaterThanOrEqual(1);
    await expect(fileExists(markerPath)).resolves.toBe(false);
  });
});
