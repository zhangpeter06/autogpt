import type { NewTaskInput } from "../core/task-queue.js";

export function planFromGoal(goal: string): NewTaskInput[] {
  const trimmed = goal.trim();
  const title = trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;

  return [
    {
      title: `Inspect project and plan first implementation step: ${title}`,
      source: "local",
      risk: "medium",
      contextFiles: ["README.md", "package.json"],
      acceptance: [
        "Project structure is inspected",
        "A concrete next implementation task is produced",
        "No unrelated files are changed"
      ]
    }
  ];
}
