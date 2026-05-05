import { appendJsonl, readJsonl } from "./jsonl.js";
import { getGptautoPaths } from "./paths.js";
import type { RiskLevel, Task, TaskSource, TaskStatus } from "./types.js";

export interface NewTaskInput {
  title: string;
  source: TaskSource;
  risk: RiskLevel;
  contextFiles: string[];
  acceptance: string[];
  parentTaskId?: string;
}

export interface TaskLists {
  queued: Task[];
  completed: Task[];
  blocked: Task[];
}

const CLOSED_STATUSES = new Set<TaskStatus>(["completed", "blocked", "cancelled"]);

export async function enqueueTask(projectRoot: string, input: NewTaskInput): Promise<Task> {
  const now = new Date().toISOString();
  const task: Task = {
    id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    project: projectRoot,
    title: input.title,
    source: input.source,
    status: "queued",
    risk: input.risk,
    attempts: 0,
    maxAttempts: 3,
    requiresApproval: input.risk === "critical",
    contextFiles: input.contextFiles,
    acceptance: input.acceptance,
    createdAt: now,
    updatedAt: now,
    ...(input.parentTaskId ? { parentTaskId: input.parentTaskId } : {})
  };
  await appendJsonl(getGptautoPaths(projectRoot).taskQueue, task);
  return task;
}

export async function listTasks(projectRoot: string): Promise<TaskLists> {
  const paths = getGptautoPaths(projectRoot);
  const latestQueuedState = compactLatest(await readJsonl<Task>(paths.taskQueue));
  return {
    queued: latestQueuedState.filter((task) => !CLOSED_STATUSES.has(task.status)),
    completed: await readJsonl<Task>(paths.completedTasks),
    blocked: await readJsonl<Task>(paths.blockedTasks)
  };
}

export async function nextQueuedTask(projectRoot: string): Promise<Task | null> {
  const latestQueuedState = compactLatest(await readJsonl<Task>(getGptautoPaths(projectRoot).taskQueue));
  return latestQueuedState.find((task) => task.status === "queued" || task.status === "repair_queued") ?? null;
}

export async function updateTaskStatus(projectRoot: string, taskId: string, status: TaskStatus): Promise<Task> {
  const paths = getGptautoPaths(projectRoot);
  const latestQueuedState = compactLatest(await readJsonl<Task>(paths.taskQueue));
  const task = latestQueuedState.find((item) => item.id === taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const updated: Task = {
    ...task,
    status,
    attempts: status === "running" ? task.attempts + 1 : task.attempts,
    updatedAt: new Date().toISOString()
  };
  await appendJsonl(paths.taskQueue, updated);
  return updated;
}

export async function completeTask(projectRoot: string, taskId: string): Promise<Task> {
  const updated = await updateTaskStatus(projectRoot, taskId, "completed");
  await appendJsonl(getGptautoPaths(projectRoot).completedTasks, updated);
  return updated;
}

export async function blockTask(projectRoot: string, task: Task, blocker: string): Promise<Task> {
  const blocked: Task = {
    ...task,
    status: "blocked",
    blocker,
    updatedAt: new Date().toISOString()
  };
  const paths = getGptautoPaths(projectRoot);
  await appendJsonl(paths.taskQueue, blocked);
  await appendJsonl(paths.blockedTasks, blocked);
  return blocked;
}

export async function createRepairTask(projectRoot: string, failedTask: Task, reason: string): Promise<Task> {
  return enqueueTask(projectRoot, {
    title: `Repair: ${failedTask.title}`,
    source: "repair",
    risk: failedTask.risk,
    contextFiles: failedTask.contextFiles,
    acceptance: [`Fix verification failure: ${reason}`],
    parentTaskId: failedTask.id
  });
}

function compactLatest(tasks: Task[]): Task[] {
  const byId = new Map<string, Task>();
  for (const task of tasks) {
    byId.set(task.id, task);
  }
  return [...byId.values()];
}
