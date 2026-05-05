import { appendJsonl, readJsonl } from "./jsonl.js";
import { getGptautoPaths } from "./paths.js";
import { loadProjectConfig } from "./project-state.js";
import type { DecisionRecord, RiskLevel } from "./types.js";

export interface DecisionInput {
  taskId: string | null;
  question: string;
  options: string[];
  recommended?: string;
  risk: RiskLevel;
  reversible: boolean;
  reason: string;
}

export async function chooseOption(projectRoot: string, input: DecisionInput): Promise<DecisionRecord> {
  const config = await loadProjectConfig(projectRoot);
  if (input.options.length === 0) {
    throw new Error("Decision requires at least one option");
  }

  const critical = input.risk === "critical";
  const blockedHigh = input.risk === "high" && !input.reversible && config.aggression !== "aggressive";
  if (critical || blockedHigh) {
    throw new Error(`Decision requires human approval: ${input.question}`);
  }

  const choice = input.recommended && input.options.includes(input.recommended) ? input.recommended : input.options[0];
  const record: DecisionRecord = {
    time: new Date().toISOString(),
    taskId: input.taskId,
    question: input.question,
    choice,
    reason: input.reason,
    risk: input.risk,
    reversible: input.reversible,
    approvedBy: `policy:auto-${config.aggression}`
  };
  await appendJsonl(getGptautoPaths(projectRoot).decisions, record);
  return record;
}

export async function listDecisions(projectRoot: string): Promise<DecisionRecord[]> {
  return readJsonl<DecisionRecord>(getGptautoPaths(projectRoot).decisions);
}
