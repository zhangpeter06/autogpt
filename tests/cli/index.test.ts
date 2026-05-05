import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createWebServer } from "../../src/web/server.js";
import { chooseOption } from "../../src/core/decisions.js";
import { resolveRunMaxTasks, shouldStopRunLoop } from "../../src/cli/index.js";
import type { Server } from "node:http";

const execFileAsync = promisify(execFile);
const servers: Server[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        })
    )
  );
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("cli commands", () => {
  it("initializes a project, saves a goal, and reports state, queue summary, and recent events", async () => {
    const projectRoot = await makeTempProject();

    const init = await runCli("init", "--project", projectRoot, "--aggression", "conservative");
    expect(init.stdout).toContain(`Initialized gptauto in ${resolve(projectRoot)}`);

    const goal = await runCli("goal", "Ship the CLI", "--project", projectRoot);
    expect(goal.stdout.trim()).toBe("Goal saved");

    await chooseOption(projectRoot, {
      taskId: null,
      question: "Use temporary web API?",
      options: ["yes", "no"],
      recommended: "yes",
      risk: "low",
      reversible: true,
      reason: "Task 10 requires a stub"
    });

    const status = await runCli("status", "--project", projectRoot);
    const output = JSON.parse(status.stdout) as {
      state: {
        goal: string | null;
        activeTaskId: string | null;
        lastRunId: string | null;
        updatedAt: string;
      };
      queue: {
        queued: number;
        completed: number;
        blocked: number;
      };
      recentEvents: Array<{ source: string; time: string; summary: string }>;
    };

    expect(output.state.goal).toBe("Ship the CLI");
    expect(output.state.activeTaskId).toBeNull();
    expect(output.state.lastRunId).toBeNull();
    expect(output.state.updatedAt).toEqual(expect.any(String));
    expect(output.queue).toEqual({ queued: 0, completed: 0, blocked: 0 });
    expect(output.recentEvents).toEqual([
      expect.objectContaining({
        source: "decision",
        summary: "Use temporary web API? -> yes"
      })
    ]);
  });

  it("uses an overnight max task default only when --max-tasks is omitted", () => {
    expect(resolveRunMaxTasks({ overnight: true })).toBe(50);
    expect(resolveRunMaxTasks({ overnight: true, maxTasks: "3" })).toBe(3);
    expect(resolveRunMaxTasks({ overnight: false })).toBe(1);
  });

  it("stops overnight loops when a repair task is queued", () => {
    expect(shouldStopRunLoop({ status: "repair_queued", runId: "run_1", taskId: "task_1", repairTaskId: "task_2" })).toBe(
      true
    );
    expect(shouldStopRunLoop({ status: "blocked", reason: "requires approval", taskId: "task_1" })).toBe(true);
    expect(shouldStopRunLoop({ status: "completed", runId: "run_1", taskId: "task_1" })).toBe(false);
  });
});

describe("web server stub", () => {
  it("serves dashboard counts", async () => {
    const app = createWebServer({ projectRoot: process.cwd() });
    const server = app.listen(0);
    servers.push(server);

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected test server to listen on a TCP port");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/api/dashboard`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      queued: 0,
      completed: 0,
      blocked: 0
    });
  });
});

async function makeTempProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "gptauto-cli-"));
  tempDirs.push(projectRoot);
  return projectRoot;
}

async function runCli(...args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(process.execPath, ["--import", "tsx", "src/cli/index.ts", ...args], {
    cwd: resolve(".")
  });
}
