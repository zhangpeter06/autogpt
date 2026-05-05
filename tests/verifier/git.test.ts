import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { getChangedFiles } from "../../src/verifier/git.js";
import { runShellCommand } from "../../src/verifier/commands.js";

async function createGitRepo(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "gptauto-git-"));
  const init = await runShellCommand("git init", projectRoot);
  expect(init.exitCode).toBe(0);
  return projectRoot;
}

describe("getChangedFiles", () => {
  it("returns staged files", async () => {
    const projectRoot = await createGitRepo();
    await writeFile(join(projectRoot, ".env"), "SECRET=value\n");
    const add = await runShellCommand("git add .env", projectRoot);
    expect(add.exitCode).toBe(0);

    await expect(getChangedFiles(projectRoot)).resolves.toContain(".env");
  });

  it("returns untracked non-ignored files", async () => {
    const projectRoot = await createGitRepo();
    await writeFile(join(projectRoot, ".env"), "SECRET=value\n");

    await expect(getChangedFiles(projectRoot)).resolves.toContain(".env");
  });

  it("de-duplicates files present in multiple git inspections", async () => {
    const projectRoot = await createGitRepo();
    await writeFile(join(projectRoot, ".env"), "SECRET=value\n");
    const add = await runShellCommand("git add .env", projectRoot);
    expect(add.exitCode).toBe(0);
    await writeFile(join(projectRoot, ".env"), "SECRET=changed\n");

    const changedFiles = await getChangedFiles(projectRoot);

    expect(changedFiles.filter((file) => file === ".env")).toHaveLength(1);
  });
});
