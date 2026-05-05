import { join } from "node:path";

export interface GptautoPaths {
  projectRoot: string;
  root: string;
  config: string;
  state: string;
  tasksDir: string;
  taskQueue: string;
  completedTasks: string;
  blockedTasks: string;
  runsDir: string;
  decisionsDir: string;
  decisions: string;
  reportsDir: string;
  claudeSync: string;
  locksDir: string;
  runLock: string;
}

export function getGptautoPaths(projectRoot: string): GptautoPaths {
  const root = join(projectRoot, ".gptauto");
  const tasksDir = join(root, "tasks");
  const runsDir = join(root, "runs");
  const decisionsDir = join(root, "decisions");
  const reportsDir = join(root, "reports");
  const locksDir = join(root, "locks");

  return {
    projectRoot,
    root,
    config: join(root, "config.json"),
    state: join(root, "state.json"),
    tasksDir,
    taskQueue: join(tasksDir, "queue.jsonl"),
    completedTasks: join(tasksDir, "completed.jsonl"),
    blockedTasks: join(tasksDir, "blocked.jsonl"),
    runsDir,
    decisionsDir,
    decisions: join(decisionsDir, "decisions.jsonl"),
    reportsDir,
    claudeSync: join(reportsDir, "claude-sync.jsonl"),
    locksDir,
    runLock: join(locksDir, "run.lock")
  };
}

export function getRunDir(projectRoot: string, runId: string): string {
  return join(getGptautoPaths(projectRoot).runsDir, runId);
}
