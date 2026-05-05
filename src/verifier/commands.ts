import { spawn } from "node:child_process";
import type { CommandResult } from "../core/types.js";

export type ShellRunner = (command: string, cwd: string) => Promise<CommandResult>;

export interface RunShellCommandOptions {
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const KILL_FALLBACK_MS = 5_000;

function terminateProcessTree(pid: number): Promise<void> {
  if (process.platform === "win32") {
    return new Promise((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
      killer.on("error", () => {
        try {
          process.kill(pid);
        } catch {
          // Process already exited.
        }
        resolve();
      });
      killer.on("close", () => {
        resolve();
      });
    });
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return Promise.resolve();
    }
  }

  return new Promise((resolve) => {
    setTimeout(() => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Process already exited.
        }
      }
      resolve();
    }, 1_000);
  });
}

export async function runShellCommand(command: string, cwd: string, options: RunShellCommandOptions = {}): Promise<CommandResult> {
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolve) => {
    const child = spawn(command, { cwd, detached: process.platform !== "win32", shell: true, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let timeoutMessage = "";
    let killFallback: ReturnType<typeof setTimeout> | undefined;
    let killProcessTree: Promise<void> = Promise.resolve();

    const finish = (exitCode: number | null, finalStderr = stderr): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (killFallback) {
        clearTimeout(killFallback);
      }
      const resolvedExitCode = timedOut && exitCode === 0 ? 1 : exitCode;
      resolve({ command, cwd, exitCode: resolvedExitCode, stdout, stderr: finalStderr, durationMs: Date.now() - started });
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      timeoutMessage = `Command timed out after ${timeoutMs}ms`;
      const finalStderr = stderr.trim() ? `${stderr.trimEnd()}\n${timeoutMessage}` : timeoutMessage;
      if (child.pid) {
        killProcessTree = terminateProcessTree(child.pid);
      } else {
        child.kill();
      }
      killFallback = setTimeout(() => {
        finish(1, finalStderr);
      }, KILL_FALLBACK_MS);
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (exitCode) => {
      if (timedOut) {
        const finalStderr = stderr.trim() ? `${stderr.trimEnd()}\n${timeoutMessage}` : timeoutMessage;
        killProcessTree.then(() => {
          finish(exitCode === 0 ? 1 : exitCode, finalStderr);
        });
        return;
      }
      finish(exitCode);
    });

    child.on("error", (error) => {
      const finalStderr = stderr.trim() ? `${stderr.trimEnd()}\n${error.message}` : error.message;
      finish(1, finalStderr);
    });
  });
}
