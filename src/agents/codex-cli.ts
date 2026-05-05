import { spawn } from "node:child_process";
import type { CommandResult, Task } from "../core/types.js";

export type CommandRunner = (
  command: string,
  args: string[],
  cwd: string,
  input: string
) => Promise<CommandResult>;

export interface RunCodexTaskInput {
  projectRoot: string;
  codexCommand: string;
  task: Task;
  runner?: CommandRunner;
}

export async function runCodexTask(input: RunCodexTaskInput): Promise<CommandResult> {
  const runner = input.runner ?? defaultRunner;
  const prompt = buildCodexPrompt(input.task);

  return runner(input.codexCommand, ["exec", "--"], input.projectRoot, prompt);
}

export function buildCodexPrompt(task: Task): string {
  return `You are executing a gptauto task.

Task ID: ${task.id}
Title: ${task.title}
Risk: ${task.risk}

Context files:
${task.contextFiles.map((file) => `- ${file}`).join("\n") || "- No specific files"}

Acceptance criteria:
${task.acceptance.map((item) => `- ${item}`).join("\n")}

Implement the task in the current repository. Run focused verification. Finish with a structured summary containing changed files, commands run, verification result, blockers, and next recommendation.`;
}

async function defaultRunner(command: string, args: string[], cwd: string, input: string): Promise<CommandResult> {
  const started = Date.now();

  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, shell: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (exitCode) => {
      resolve({
        command: `${command} ${args.join(" ")}`,
        cwd,
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - started
      });
    });

    child.stdin.end(input);
  });
}
