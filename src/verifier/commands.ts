import { spawn } from "node:child_process";
import type { CommandResult } from "../core/types.js";

export type ShellRunner = (command: string, cwd: string) => Promise<CommandResult>;

export interface RunShellCommandOptions {
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export async function runShellCommand(command: string, cwd: string, options: RunShellCommandOptions = {}): Promise<CommandResult> {
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (exitCode: number | null, finalStderr = stderr): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({ command, cwd, exitCode, stdout, stderr: finalStderr, durationMs: Date.now() - started });
    };

    const timeout = setTimeout(() => {
      const timeoutMessage = `Command timed out after ${timeoutMs}ms`;
      const finalStderr = stderr.trim() ? `${stderr.trimEnd()}\n${timeoutMessage}` : timeoutMessage;
      child.kill();
      finish(1, finalStderr);
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (exitCode) => {
      finish(exitCode);
    });

    child.on("error", (error) => {
      const finalStderr = stderr.trim() ? `${stderr.trimEnd()}\n${error.message}` : error.message;
      finish(1, finalStderr);
    });
  });
}
