import { appendJsonl, readJsonl } from "../core/jsonl.js";
import { getGptautoPaths } from "../core/paths.js";

export interface AutomaticQuestionAnswer {
  question: string;
  choice: string;
  reason: string;
}

export interface ClaudeSyncRecord {
  time: string;
  type: "execution_report" | "planning_fallback";
  status: "pending_sync" | "synced";
  summary: string;
  changedFiles: string[];
  questionsAnsweredAutomatically: AutomaticQuestionAnswer[];
  nextPlanUsedWithoutClaude: boolean;
}

export type ClaudeSyncInput = Omit<ClaudeSyncRecord, "time" | "status" | "questionsAnsweredAutomatically"> & {
  questionsAnsweredAutomatically?: AutomaticQuestionAnswer[];
};

export async function appendClaudeSync(
  projectRoot: string,
  record: ClaudeSyncInput
): Promise<ClaudeSyncRecord> {
  const { questionsAnsweredAutomatically = [], ...rest } = record;
  const full: ClaudeSyncRecord = {
    time: new Date().toISOString(),
    status: "pending_sync",
    ...rest,
    questionsAnsweredAutomatically
  };
  await appendJsonl(getGptautoPaths(projectRoot).claudeSync, full);
  return full;
}

export async function listClaudeSync(projectRoot: string): Promise<ClaudeSyncRecord[]> {
  return readJsonl<ClaudeSyncRecord>(getGptautoPaths(projectRoot).claudeSync);
}
