import express from "express";

export function createWebServer(_options: { projectRoot: string }) {
  const app = express();
  app.get("/api/dashboard", (_req, res) => {
    res.json({ queued: 0, completed: 0, blocked: 0 });
  });
  return app;
}
