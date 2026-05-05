import type { CommandResult, VerificationResult } from "../core/types.js";
import { runShellCommand, type ShellRunner } from "./commands.js";
import { classifyRiskFromDiffSummary } from "./risk.js";

export interface VerifyProjectInput {
  projectRoot: string;
  commands: string[];
  changedFiles: string[];
  runner?: ShellRunner;
}

export async function verifyProject(input: VerifyProjectInput): Promise<VerificationResult> {
  const runner = input.runner ?? runShellCommand;
  const commands: CommandResult[] = [];
  const findings: string[] = [];

  for (const command of input.commands) {
    const result = await runner(command, input.projectRoot);
    commands.push(result);

    if (result.exitCode !== 0) {
      findings.push(`Command failed: ${command}`);
      if (result.stderr.trim()) {
        findings.push(result.stderr.trim());
      }
    }
  }

  return {
    ok: findings.length === 0,
    commands,
    risk: classifyRiskFromDiffSummary(input.changedFiles),
    findings
  };
}
