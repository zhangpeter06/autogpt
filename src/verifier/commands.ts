import { spawn } from "node:child_process";
import type { CommandResult } from "../core/types.js";

export type ShellRunner = (command: string, cwd: string) => Promise<CommandResult>;

export async function runShellCommand(command: string, cwd: string): Promise<CommandResult> {
  const started = Date.now();

  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (exitCode) => {
      resolve({ command, cwd, exitCode, stdout, stderr, durationMs: Date.now() - started });
    });
  });
}
