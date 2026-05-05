import express from "express";
import type { NextFunction, Request, Response } from "express";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { listClaudeSync } from "../agents/claude-sync.js";
import { listDecisions } from "../core/decisions.js";
import { listTasks } from "../core/task-queue.js";

interface WebServerOptions {
  projectRoot: string;
}

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

export function createWebServer(options: WebServerOptions) {
  const app = express();
  app.use(express.json());

  app.get(
    "/api/dashboard",
    asyncHandler(async (_req, res) => {
      const tasks = await listTasks(options.projectRoot);
      res.json({
        queued: tasks.queued.length,
        completed: tasks.completed.length,
        blocked: tasks.blocked.length
      });
    })
  );
  app.get(
    "/api/tasks",
    asyncHandler(async (_req, res) => {
      res.json(await listTasks(options.projectRoot));
    })
  );
  app.get(
    "/api/decisions",
    asyncHandler(async (_req, res) => {
      res.json(await listDecisions(options.projectRoot));
    })
  );
  app.get(
    "/api/claude-sync",
    asyncHandler(async (_req, res) => {
      res.json(await listClaudeSync(options.projectRoot));
    })
  );

  const publicDir = resolvePublicDir();
  if (publicDir) {
    app.use(express.static(publicDir));
  }

  return app;
}

function asyncHandler(handler: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function resolvePublicDir(): string | null {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(moduleDir, "public"),
    join(moduleDir, "..", "..", "src", "web", "public"),
    join(process.cwd(), "src", "web", "public")
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}
