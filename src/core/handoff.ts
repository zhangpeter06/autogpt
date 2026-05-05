import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getRunDir } from "./paths.js";

export interface HandoffInput {
  goal: string;
  currentTask: string;
  changedFiles: string[];
  verification: string;
  decisions: string[];
  blockers: string[];
  nextAction: string;
}

export async function writeHandoff(projectRoot: string, runId: string, input: HandoffInput): Promise<string> {
  const runDir = getRunDir(projectRoot, runId);
  await mkdir(runDir, { recursive: true });
  const filePath = join(runDir, "handoff.md");
  const content = `# Handoff: ${runId}

## Goal

${input.goal}

## Current Task

${input.currentTask}

## Changed Files

${list(input.changedFiles, "No changed files recorded")}

## Verification

${input.verification}

## Decisions

${list(input.decisions, "No automatic decisions recorded")}

## Blockers

${list(input.blockers, "No blockers recorded")}

## Next Action

${input.nextAction}

## Recovery Instructions

Read this file, inspect the run report in the same directory, then run \`gptauto status\` from the project root.
`;
  await writeFile(filePath, content, "utf8");
  return filePath;
}

function list(items: string[], empty: string): string {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : `- ${empty}`;
}
