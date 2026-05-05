#!/usr/bin/env node
import { Command } from "commander";
import { resolve } from "node:path";
import { initProject, setProjectGoal } from "../core/project-state.js";
import { runOnce } from "../core/run-loop.js";
import { listTasks } from "../core/task-queue.js";
import type { Aggression } from "../core/types.js";
import { createWebServer } from "../web/server.js";

const program = new Command();

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
  .option("--max-tasks <count>", "Maximum tasks", "1")
  .action(async (options: { project: string; overnight?: boolean; maxHours: string; maxTasks: string }) => {
    const maxTasks = parsePositiveInteger(options.maxTasks, "--max-tasks");
    const maxHours = parsePositiveNumber(options.maxHours, "--max-hours");
    const deadline = Date.now() + maxHours * 60 * 60 * 1000;
    for (let index = 0; index < maxTasks; index += 1) {
      if (Date.now() > deadline) {
        console.log(JSON.stringify({ status: "stopped", reason: "max-hours reached" }, null, 2));
        break;
      }
      const result = await runOnce({ projectRoot: resolve(options.project) });
      console.log(JSON.stringify(result, null, 2));
      if (result.status === "blocked") {
        break;
      }
    }
  });

program
  .command("status")
  .option("--project <path>", "Project path", process.cwd())
  .action(async (options: { project: string }) => {
    const tasks = await listTasks(resolve(options.project));
    console.log(
      JSON.stringify(
        {
          queued: tasks.queued.length,
          completed: tasks.completed.length,
          blocked: tasks.blocked.length
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

await program.parseAsync(process.argv);

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
