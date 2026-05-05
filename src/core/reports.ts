import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getRunDir } from "./paths.js";

export interface RunReportInput {
  taskTitle: string;
  status: string;
  changedFiles: string[];
  verificationOk: boolean;
  findings: string[];
}

export async function writeRunReport(projectRoot: string, runId: string, input: RunReportInput): Promise<string> {
  const runDir = getRunDir(projectRoot, runId);
  await mkdir(runDir, { recursive: true });
  const filePath = join(runDir, "report.md");
  const changed = input.changedFiles.length
    ? input.changedFiles.map((file) => `- ${file}`).join("\n")
    : "- No file changes recorded";
  const findings = input.findings.length
    ? input.findings.map((item) => `- ${item}`).join("\n")
    : "- No verifier findings";
  const content = `# Run Report: ${runId}

## Task

${input.taskTitle}

## Status

${input.status}

## Verification

${input.verificationOk ? "Passed" : "Failed"}

## Changed Files

${changed}

## Findings

${findings}
`;
  await writeFile(filePath, content, "utf8");
  return filePath;
}
