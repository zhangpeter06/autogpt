import type { Server } from "node:http";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { appendClaudeSync } from "../../src/agents/claude-sync.js";
import { chooseOption } from "../../src/core/decisions.js";
import { getGptautoPaths } from "../../src/core/paths.js";
import { initProject } from "../../src/core/project-state.js";
import { blockTask, completeTask, enqueueTask } from "../../src/core/task-queue.js";
import { createWebServer } from "../../src/web/server.js";

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
  await rm(resolve("dist"), { recursive: true, force: true });
});

describe("web server", () => {
  it("serves dashboard counts for an initialized empty project", async () => {
    const projectRoot = await makeProject();
    const baseUrl = await listen(projectRoot);

    const response = await fetch(`${baseUrl}/api/dashboard`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      queued: 0,
      completed: 0,
      blocked: 0
    });
  });

  it("computes dashboard counts from task lists", async () => {
    const projectRoot = await makeProject();
    await enqueueTask(projectRoot, taskInput("Queued task"));
    const completed = await enqueueTask(projectRoot, taskInput("Completed task"));
    await completeTask(projectRoot, completed.id);
    const blocked = await enqueueTask(projectRoot, taskInput("Blocked task"));
    await blockTask(projectRoot, blocked, "Needs human input");
    const baseUrl = await listen(projectRoot);

    const response = await fetch(`${baseUrl}/api/dashboard`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      queued: 1,
      completed: 1,
      blocked: 1
    });
  });

  it("serves tasks, decisions, and Claude sync JSON", async () => {
    const projectRoot = await makeProject();
    const task = await enqueueTask(projectRoot, taskInput("Review queue"));
    await chooseOption(projectRoot, {
      taskId: task.id,
      question: "Proceed with low-risk change?",
      options: ["yes", "no"],
      recommended: "yes",
      risk: "low",
      reversible: true,
      reason: "Test coverage is narrow"
    });
    await appendClaudeSync(projectRoot, {
      type: "execution_report",
      summary: "Implemented web console",
      changedFiles: ["src/web/server.ts"],
      nextPlanUsedWithoutClaude: false
    });
    const baseUrl = await listen(projectRoot);

    const [tasksResponse, decisionsResponse, claudeSyncResponse] = await Promise.all([
      fetch(`${baseUrl}/api/tasks`),
      fetch(`${baseUrl}/api/decisions`),
      fetch(`${baseUrl}/api/claude-sync`)
    ]);

    expect(tasksResponse.status).toBe(200);
    await expect(tasksResponse.json()).resolves.toMatchObject({
      queued: [expect.objectContaining({ title: "Review queue" })],
      completed: [],
      blocked: []
    });
    expect(decisionsResponse.status).toBe(200);
    await expect(decisionsResponse.json()).resolves.toEqual([
      expect.objectContaining({
        question: "Proceed with low-risk change?",
        choice: "yes"
      })
    ]);
    expect(claudeSyncResponse.status).toBe(200);
    await expect(claudeSyncResponse.json()).resolves.toEqual([
      expect.objectContaining({
        type: "execution_report",
        status: "pending_sync",
        summary: "Implemented web console"
      })
    ]);
  });

  it("serves the static console HTML", async () => {
    const projectRoot = await makeProject();
    const baseUrl = await listen(projectRoot);

    const response = await fetch(`${baseUrl}/`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    await expect(response.text()).resolves.toContain("gptauto Web Console");
  });

  it("returns sanitized JSON for API route failures", async () => {
    const projectRoot = await makeProject();
    await writeFile(getGptautoPaths(projectRoot).taskQueue, "{invalid json", "utf8");
    const baseUrl = await listen(projectRoot);

    const response = await fetch(`${baseUrl}/api/tasks`);
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(JSON.parse(body)).toEqual({ error: "Internal server error" });
    expect(body).not.toContain("SyntaxError");
    expect(body).not.toContain("JSON.parse");
    expect(body).not.toContain(projectRoot);
    expect(body).not.toContain(resolve("."));
  });

  it("serves source static assets when running from the compiled server without dist public assets", async () => {
    const projectRoot = await makeProject();
    await execFileAsync(process.execPath, [resolve("node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json"], {
      cwd: resolve(".")
    });
    await rm(resolve("dist", "web", "public"), { recursive: true, force: true });
    const module = (await import(pathToFileURL(resolve("dist", "web", "server.js")).href)) as {
      createWebServer: typeof createWebServer;
    };
    const baseUrl = await listen(projectRoot, module.createWebServer);

    const response = await fetch(`${baseUrl}/`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    await expect(response.text()).resolves.toContain("gptauto Web Console");
  });
});

async function makeProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "gptauto-web-"));
  tempDirs.push(projectRoot);
  await initProject({ projectRoot, aggression: "balanced" });
  return projectRoot;
}

async function listen(projectRoot: string, serverFactory = createWebServer): Promise<string> {
  const app = serverFactory({ projectRoot });
  const server = app.listen(0);
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected test server to listen on a TCP port");
  }
  return `http://127.0.0.1:${address.port}`;
}

function taskInput(title: string) {
  return {
    title,
    source: "planner" as const,
    risk: "low" as const,
    contextFiles: [],
    acceptance: [`${title} is handled`]
  };
}
