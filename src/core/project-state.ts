import { mkdir, readFile, writeFile } from "node:fs/promises";
import { writeJsonFile } from "./atomic-file.js";
import { getGptautoPaths } from "./paths.js";
import type { Aggression, ProjectConfig, ProjectState } from "./types.js";

export interface InitProjectOptions {
  projectRoot: string;
  aggression?: Aggression;
  testCommands?: string[];
  lintCommands?: string[];
  typecheckCommands?: string[];
  codexCommand?: string;
  claudeCommand?: string;
}

export async function initProject(options: InitProjectOptions): Promise<void> {
  const paths = getGptautoPaths(options.projectRoot);
  await mkdir(paths.tasksDir, { recursive: true });
  await mkdir(paths.runsDir, { recursive: true });
  await mkdir(paths.decisionsDir, { recursive: true });
  await mkdir(paths.reportsDir, { recursive: true });
  await mkdir(paths.locksDir, { recursive: true });

  const now = new Date().toISOString();
  const existingConfig = await readJsonIfExists<ProjectConfig>(paths.config);
  const config: ProjectConfig = {
    projectRoot: options.projectRoot,
    aggression: options.aggression ?? existingConfig?.aggression ?? "balanced",
    testCommands: options.testCommands ?? existingConfig?.testCommands ?? ["npm test"],
    lintCommands: options.lintCommands ?? existingConfig?.lintCommands ?? [],
    typecheckCommands: options.typecheckCommands ?? existingConfig?.typecheckCommands ?? ["npm run typecheck"],
    codexCommand: options.codexCommand ?? existingConfig?.codexCommand ?? "codex",
    ...(options.claudeCommand ?? existingConfig?.claudeCommand
      ? { claudeCommand: options.claudeCommand ?? existingConfig?.claudeCommand }
      : {})
  };

  const existingState = await readJsonIfExists<ProjectState>(paths.state);
  const state: ProjectState = existingState ?? {
    version: 1,
    goal: null,
    activeTaskId: null,
    lastRunId: null,
    createdAt: now,
    updatedAt: now
  };

  await writeJsonFile(paths.config, config);
  if (!existingState) {
    await writeJsonFile(paths.state, state);
  }
  await writeFile(paths.taskQueue, "", { flag: "a" });
  await writeFile(paths.completedTasks, "", { flag: "a" });
  await writeFile(paths.blockedTasks, "", { flag: "a" });
  await writeFile(paths.decisions, "", { flag: "a" });
  await writeFile(paths.claudeSync, "", { flag: "a" });
}

export async function loadProjectConfig(projectRoot: string): Promise<ProjectConfig> {
  const paths = getGptautoPaths(projectRoot);
  return JSON.parse(await readFile(paths.config, "utf8")) as ProjectConfig;
}

export async function loadProjectState(projectRoot: string): Promise<ProjectState> {
  const paths = getGptautoPaths(projectRoot);
  return JSON.parse(await readFile(paths.state, "utf8")) as ProjectState;
}

export async function saveProjectState(projectRoot: string, state: ProjectState): Promise<void> {
  await writeJsonFile(getGptautoPaths(projectRoot).state, {
    ...state,
    updatedAt: new Date().toISOString()
  });
}

export async function setProjectGoal(projectRoot: string, goal: string): Promise<ProjectState> {
  const state = await loadProjectState(projectRoot);
  const next = { ...state, goal, updatedAt: new Date().toISOString() };
  await saveProjectState(projectRoot, next);
  return next;
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}
