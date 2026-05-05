import { runShellCommand } from "./commands.js";

export async function getChangedFiles(projectRoot: string): Promise<string[]> {
  const results = await Promise.all([
    runShellCommand("git diff --name-only", projectRoot),
    runShellCommand("git diff --cached --name-only", projectRoot),
    runShellCommand("git ls-files --others --exclude-standard", projectRoot)
  ]);

  const successfulResults = results.filter((result) => result.exitCode === 0);
  if (successfulResults.length === 0) {
    return [];
  }

  const changedFiles = new Set<string>();
  for (const result of successfulResults) {
    for (const line of result.stdout.split(/\r?\n/)) {
      const file = line.trim();
      if (file) {
        changedFiles.add(file);
      }
    }
  }

  return [...changedFiles];
}
