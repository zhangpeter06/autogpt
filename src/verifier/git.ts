import { runShellCommand } from "./commands.js";

export async function getChangedFiles(projectRoot: string): Promise<string[]> {
  const result = await runShellCommand("git diff --name-only", projectRoot);
  if (result.exitCode !== 0) {
    return [];
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}
