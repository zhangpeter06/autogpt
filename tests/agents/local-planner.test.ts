import { describe, expect, it } from "vitest";
import { planFromGoal } from "../../src/agents/local-planner.js";

describe("planFromGoal", () => {
  it("creates small queued tasks from a goal", () => {
    const tasks = planFromGoal("Build login and registration");

    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks[0].source).toBe("local");
    expect(tasks[0].acceptance.length).toBeGreaterThan(0);
  });
});
