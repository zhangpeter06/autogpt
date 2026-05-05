#!/usr/bin/env node
import { Command } from "commander";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { listClaudeSync } from "../agents/claude-sync.js";
import { listDecisions } from "../core/decisions.js";
import { initProject, loadProjectState, setProjectGoal } from "../core/project-state.js";
import { runOnce, type RunOnceResult } from "../core/run-loop.js";
import { listTasks } from "../core/task-queue.js";
import type { Aggression } from "../core/types.js";
import { createWebServer } from "../web/server.js";

const program = new Command();
const OVERNIGHT_MAX_TASKS = 50;

program.name("gptauto").description("Local agentic development orchestrator").version("0.1.0");

program
  .command("init")
  .requiredOption("--project <path>", "Project path")
  .option("--aggression <mode>", "Automation aggression", "balanced")
  .action(async (options: { project: string; aggression: string }) => {
    const aggression = parseAggression(options.aggression);
    await initProject({ projectRoot: resolve(options.project), aggression });
    console.log(`Initialized gptauto in ${resolve(options.project)}`);
  });

program
  .command("goal")
  .argument("<goal>", "Project goal")
  .option("--project <path>", "Project path", process.cwd())
  .action(async (goal: string, options: { project: string }) => {
    await setProjectGoal(resolve(options.project), goal);
    console.log("Goal saved");
  });

program
  .command("run")
  .option("--project <path>", "Project path", process.cwd())
  .option("--overnight", "Run until max tasks, max hours, or blocked")
  .option("--max-hours <hours>", "Maximum hours", "8")
  .option("--max-tasks <count>", "Maximum tasks")
  .action(async (options: { project: string; overnight?: boolean; maxHours: string; maxTasks?: string }) => {
    const maxTasks = resolveRunMaxTasks(options);
    const maxHours = parsePositiveNumber(options.maxHours, "--max-hours");
    const deadline = Date.now() + maxHours * 60 * 60 * 1000;
    for (let index = 0; index < maxTasks; index += 1) {
      if (Date.now() > deadline) {
        console.log(JSON.stringify({ status: "stopped", reason: "max-hours reached" }, null, 2));
        break;
      }
      const result = await runOnce({ projectRoot: resolve(options.project) });
      console.log(JSON.stringify(result, null, 2));
      if (shouldStopRunLoop(result)) {
        break;
      }
    }
  });

program
  .command("status")
  .option("--project <path>", "Project path", process.cwd())
  .action(async (options: { project: string }) => {
    const projectRoot = resolve(options.project);
    const [state, tasks, decisions, claudeSync] = await Promise.all([
      loadProjectState(projectRoot),
      listTasks(projectRoot),
      listDecisions(projectRoot),
      listClaudeSync(projectRoot)
    ]);
    const recentEvents = [
      ...decisions.map((decision) => ({
        source: "decision",
        time: decision.time,
        summary: `${decision.question} -> ${decision.choice}`
      })),
      ...claudeSync.map((record) => ({
        source: "claude-sync",
        time: record.time,
        summary: record.summary
      }))
    ]
      .sort((left, right) => right.time.localeCompare(left.time))
      .slice(0, 10);

    console.log(
      JSON.stringify(
        {
          state: {
            goal: state.goal,
            activeTaskId: state.activeTaskId,
            lastRunId: state.lastRunId,
            updatedAt: state.updatedAt
          },
          queue: {
            queued: tasks.queued.length,
            completed: tasks.completed.length,
            blocked: tasks.blocked.length
          },
          recentEvents
        },
        null,
        2
      )
    );
  });

program
  .command("web")
  .option("--project <path>", "Project path", process.cwd())
  .option("--port <port>", "Port", "4789")
  .action(async (options: { project: string; port: string }) => {
    const app = createWebServer({ projectRoot: resolve(options.project) });
    const port = parsePositiveInteger(options.port, "--port");
    app.listen(port, () => {
      console.log(`gptauto web console listening on http://localhost:${port}`);
    });
  });

if (isCliEntrypoint()) {
  await program.parseAsync(process.argv);
}

function parseAggression(value: string): Aggression {
  if (value === "conservative" || value === "balanced" || value === "aggressive") {
    return value;
  }
  throw new Error("--aggression must be one of: conservative, balanced, aggressive");
}

function parsePositiveNumber(value: string, optionName: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a finite positive number`);
  }
  return parsed;
}

function parsePositiveInteger(value: string, optionName: string): number {
  const parsed = parsePositiveNumber(value, optionName);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${optionName} must be a positive integer`);
  }
  return parsed;
}

export function resolveRunMaxTasks(options: { overnight?: boolean; maxTasks?: string }): number {
  if (options.maxTasks !== undefined) {
    return parsePositiveInteger(options.maxTasks, "--max-tasks");
  }
  return options.overnight ? OVERNIGHT_MAX_TASKS : 1;
}

export function shouldStopRunLoop(result: RunOnceResult): boolean {
  return result.status === "blocked" || result.status === "repair_queued";
}

function isCliEntrypoint(): boolean {
  return process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}
