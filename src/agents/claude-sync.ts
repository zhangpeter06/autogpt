import { appendJsonl, readJsonl } from "../core/jsonl.js";
import { getGptautoPaths } from "../core/paths.js";

export interface ClaudeSyncRecord {
  time: string;
  type: "execution_report" | "planning_fallback";
  status: "pending_sync" | "synced";
  summary: string;
  changedFiles: string[];
  nextPlanUsedWithoutClaude: boolean;
}

export async function appendClaudeSync(
  projectRoot: string,
  record: Omit<ClaudeSyncRecord, "time" | "status">
): Promise<ClaudeSyncRecord> {
  const full: ClaudeSyncRecord = {
    time: new Date().toISOString(),
    status: "pending_sync",
    ...record
  };
  await appendJsonl(getGptautoPaths(projectRoot).claudeSync, full);
  return full;
}

export async function listClaudeSync(projectRoot: string): Promise<ClaudeSyncRecord[]> {
  return readJsonl<ClaudeSyncRecord>(getGptautoPaths(projectRoot).claudeSync);
}
