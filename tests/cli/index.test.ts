import { afterEach, describe, expect, it } from "vitest";
import { createWebServer } from "../../src/web/server.js";
import type { Server } from "node:http";

const servers: Server[] = [];

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
