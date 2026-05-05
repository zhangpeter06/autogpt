# Web-First Controller Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current read-only web console into the main local controller for configuring projects, running gptauto, detecting likely context stalls, and generating recovery packages.

**Architecture:** Add a small `src/controller/*` layer for durable controller records, web configuration, stall analysis, recovery package generation, and process-local run orchestration. The Express server owns one controller runtime and exposes `/api/controller/*`; the static UI becomes a setup/control/recovery console while the existing CLI remains a fallback.

**Tech Stack:** Node.js, TypeScript, Express, Vitest, existing `.gptauto/` JSON/JSONL persistence, existing `runOnce` loop.

---

## File Structure

- `src/core/types.ts`: extend `ProjectConfig` with optional web/controller fields.
- `src/core/paths.ts`: add controller and recovery package paths.
- `src/core/project-state.ts`: add `saveProjectConfig()` helper.
- `src/controller/config.ts`: validate and save web configuration, read goal documents, initialize projects.
- `src/controller/record.ts`: create/update `.gptauto/controller.json`.
- `src/controller/stall.ts`: pure and file-backed stall detection.
- `src/controller/recovery.ts`: build recovery package from durable state.
- `src/controller/runtime.ts`: process-local run controller for web-triggered loops.
- `src/web/server.ts`: mount controller APIs and make existing read APIs use the runtime's current project root.
- `src/web/public/index.html`: replace read-only layout with setup/control/recovery panels.
- `src/web/public/app.js`: client-side form handling, polling, run controls, recovery display.
- `src/web/public/styles.css`: operational console layout.
- `README.md`: update quick start for web-first use.

Tests:

- `tests/core/project-state.test.ts`
- `tests/controller/config.test.ts`
- `tests/controller/record.test.ts`
- `tests/controller/stall.test.ts`
- `tests/controller/recovery.test.ts`
- `tests/controller/runtime.test.ts`
- `tests/web/controller-api.test.ts`
- `tests/web/server.test.ts`

---

### Task 1: Extend Durable Types and Paths

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/paths.ts`
- Modify: `src/core/project-state.ts`
- Test: `tests/core/project-state.test.ts`

- [ ] **Step 1: Write failing tests for extended config and controller paths**

Append these tests to `tests/core/project-state.test.ts`:

```ts
it("derives controller and recovery paths", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "gptauto-controller-paths-"));
  try {
    const paths = getGptautoPaths(projectRoot);
    expect(paths.controller).toBe(join(projectRoot, ".gptauto", "controller.json"));
    expect(paths.recoveryPackage).toBe(join(projectRoot, ".gptauto", "reports", "recovery-package.md"));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

it("preserves optional controller config fields across init", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "gptauto-config-extend-"));
  try {
    await initProject({
      projectRoot,
      aggression: "balanced",
      testCommands: ["npm test"],
      typecheckCommands: ["npm run typecheck"]
    });
    await saveProjectConfig(projectRoot, {
      ...(await loadProjectConfig(projectRoot)),
      goalDocumentPath: join(projectRoot, "PLAN.md"),
      runDefaults: { maxTasks: 7, maxHours: 3, overnight: true },
      stallPolicy: { activeTaskMinutes: 10, lockMinutes: 20, artifactMinutes: 15 }
    });

    await initProject({ projectRoot, aggression: "aggressive" });

    const config = await loadProjectConfig(projectRoot);
    expect(config.aggression).toBe("aggressive");
    expect(config.goalDocumentPath).toBe(join(projectRoot, "PLAN.md"));
    expect(config.runDefaults).toEqual({ maxTasks: 7, maxHours: 3, overnight: true });
    expect(config.stallPolicy).toEqual({ activeTaskMinutes: 10, lockMinutes: 20, artifactMinutes: 15 });
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the targeted test and verify it fails**

Run:

```powershell
npm test -- tests/core/project-state.test.ts
```

Expected: FAIL because `controller`, `recoveryPackage`, and `saveProjectConfig` do not exist yet.

- [ ] **Step 3: Extend types and paths**

Update `src/core/types.ts`:

```ts
export interface RunDefaults {
  maxTasks: number;
  maxHours: number;
  overnight: boolean;
}

export interface StallPolicy {
  activeTaskMinutes: number;
  lockMinutes: number;
  artifactMinutes: number;
}

export interface ProjectConfig {
  projectRoot: string;
  aggression: Aggression;
  testCommands: string[];
  lintCommands: string[];
  typecheckCommands: string[];
  codexCommand: string;
  claudeCommand?: string;
  goalDocumentPath?: string;
  runDefaults?: RunDefaults;
  stallPolicy?: StallPolicy;
}
```

Update `src/core/paths.ts`:

```ts
export interface GptautoPaths {
  projectRoot: string;
  root: string;
  config: string;
  state: string;
  controller: string;
  tasksDir: string;
  taskQueue: string;
  completedTasks: string;
  blockedTasks: string;
  runsDir: string;
  decisionsDir: string;
  decisions: string;
  reportsDir: string;
  claudeSync: string;
  recoveryPackage: string;
  locksDir: string;
  runLock: string;
}
```

Add returned paths:

```ts
controller: join(root, "controller.json"),
recoveryPackage: join(reportsDir, "recovery-package.md"),
```

- [ ] **Step 4: Add `saveProjectConfig()`**

In `src/core/project-state.ts`, export:

```ts
export async function saveProjectConfig(projectRoot: string, config: ProjectConfig): Promise<void> {
  await writeJsonFile(getGptautoPaths(projectRoot).config, config);
}
```

Update `initProject()` so existing optional fields are preserved unless explicitly overridden:

```ts
goalDocumentPath: options.goalDocumentPath ?? existingConfig?.goalDocumentPath,
runDefaults: options.runDefaults ?? existingConfig?.runDefaults,
stallPolicy: options.stallPolicy ?? existingConfig?.stallPolicy
```

Add these fields to `InitProjectOptions`.

- [ ] **Step 5: Run tests**

Run:

```powershell
npm test -- tests/core/project-state.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/core/types.ts src/core/paths.ts src/core/project-state.ts tests/core/project-state.test.ts
git commit -m "feat: extend controller config state"
```

---

### Task 2: Add Web Configuration Service

**Files:**
- Create: `src/controller/config.ts`
- Create: `tests/controller/config.test.ts`
- Modify: `src/core/project-state.ts` if Task 1 did not add all needed helpers

- [ ] **Step 1: Write failing config service tests**

Create `tests/controller/config.test.ts`:

```ts
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { loadProjectConfig, loadProjectState, setProjectGoal } from "../../src/core/project-state.js";
import { saveControllerConfig, getControllerConfig } from "../../src/controller/config.js";

describe("controller config", () => {
  it("initializes a project and saves a direct goal from web input", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "gptauto-web-config-"));
    try {
      const result = await saveControllerConfig({
        projectRoot,
        aggression: "aggressive",
        codexCommand: "codex",
        claudeCommand: "claude",
        testCommandsText: "npm test\nnpm run test:unit",
        lintCommandsText: "",
        typecheckCommandsText: "npm run typecheck",
        goal: "Build the dashboard",
        runDefaults: { maxTasks: 5, maxHours: 2, overnight: false },
        stallPolicy: { activeTaskMinutes: 30, lockMinutes: 45, artifactMinutes: 30 }
      });

      expect(result.initialized).toBe(true);
      const config = await loadProjectConfig(projectRoot);
      const state = await loadProjectState(projectRoot);
      expect(config.projectRoot).toBe(projectRoot);
      expect(config.aggression).toBe("aggressive");
      expect(config.codexCommand).toBe("codex");
      expect(config.claudeCommand).toBe("claude");
      expect(config.testCommands).toEqual(["npm test", "npm run test:unit"]);
      expect(config.typecheckCommands).toEqual(["npm run typecheck"]);
      expect(config.runDefaults).toEqual({ maxTasks: 5, maxHours: 2, overnight: false });
      expect(state.goal).toBe("Build the dashboard");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("loads the goal from a local document path", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "gptauto-goal-doc-"));
    try {
      const goalPath = join(projectRoot, "GOAL.md");
      await writeFile(goalPath, "# Goal\n\nShip the app.", "utf8");
      await saveControllerConfig({
        projectRoot,
        aggression: "balanced",
        codexCommand: "codex",
        testCommandsText: "npm test",
        lintCommandsText: "",
        typecheckCommandsText: "npm run typecheck",
        goalDocumentPath: goalPath,
        runDefaults: { maxTasks: 1, maxHours: 1, overnight: false },
        stallPolicy: { activeTaskMinutes: 30, lockMinutes: 45, artifactMinutes: 30 }
      });

      const config = await loadProjectConfig(projectRoot);
      const state = await loadProjectState(projectRoot);
      expect(config.goalDocumentPath).toBe(goalPath);
      expect(state.goal).toBe("# Goal\n\nShip the app.");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("preserves recovery state when saving config over an existing project", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "gptauto-config-preserve-"));
    try {
      await saveControllerConfig({
        projectRoot,
        aggression: "balanced",
        codexCommand: "codex",
        testCommandsText: "npm test",
        lintCommandsText: "",
        typecheckCommandsText: "npm run typecheck",
        goal: "Original goal",
        runDefaults: { maxTasks: 1, maxHours: 1, overnight: false },
        stallPolicy: { activeTaskMinutes: 30, lockMinutes: 45, artifactMinutes: 30 }
      });
      const withGoal = await setProjectGoal(projectRoot, "Keep recovery state");
      await saveControllerConfig({
        projectRoot,
        aggression: "aggressive",
        codexCommand: "codex",
        testCommandsText: "npm test",
        lintCommandsText: "",
        typecheckCommandsText: "npm run typecheck",
        runDefaults: { maxTasks: 3, maxHours: 2, overnight: true },
        stallPolicy: { activeTaskMinutes: 30, lockMinutes: 45, artifactMinutes: 30 }
      });

      const state = await loadProjectState(projectRoot);
      expect(state.createdAt).toBe(withGoal.createdAt);
      expect(state.goal).toBe("Keep recovery state");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("returns a clear error for a missing goal document", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "gptauto-missing-goal-"));
    try {
      await expect(
        saveControllerConfig({
          projectRoot,
          aggression: "balanced",
          codexCommand: "codex",
          testCommandsText: "npm test",
          lintCommandsText: "",
          typecheckCommandsText: "npm run typecheck",
          goalDocumentPath: join(projectRoot, "missing.md"),
          runDefaults: { maxTasks: 1, maxHours: 1, overnight: false },
          stallPolicy: { activeTaskMinutes: 30, lockMinutes: 45, artifactMinutes: 30 }
        })
      ).rejects.toThrow("Goal document was not found");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("reads current controller config", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "gptauto-config-read-"));
    try {
      await saveControllerConfig({
        projectRoot,
        aggression: "conservative",
        codexCommand: "codex",
        testCommandsText: "npm test",
        lintCommandsText: "",
        typecheckCommandsText: "npm run typecheck",
        goal: "Read config",
        runDefaults: { maxTasks: 1, maxHours: 1, overnight: false },
        stallPolicy: { activeTaskMinutes: 30, lockMinutes: 45, artifactMinutes: 30 }
      });

      const current = await getControllerConfig(projectRoot);
      expect(current.initialized).toBe(true);
      expect(current.config?.aggression).toBe("conservative");
      expect(current.state?.goal).toBe("Read config");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test and verify it fails**

```powershell
npm test -- tests/controller/config.test.ts
```

Expected: FAIL because `src/controller/config.ts` does not exist.

- [ ] **Step 3: Implement `src/controller/config.ts`**

Create:

```ts
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { initProject, loadProjectConfig, loadProjectState, saveProjectConfig, setProjectGoal } from "../core/project-state.js";
import type { Aggression, ProjectConfig, ProjectState, RunDefaults, StallPolicy } from "../core/types.js";

const MAX_GOAL_DOCUMENT_BYTES = 1024 * 1024;

export interface ControllerConfigInput {
  projectRoot: string;
  aggression: Aggression;
  codexCommand: string;
  claudeCommand?: string;
  testCommandsText: string;
  lintCommandsText: string;
  typecheckCommandsText: string;
  goal?: string;
  goalDocumentPath?: string;
  runDefaults: RunDefaults;
  stallPolicy: StallPolicy;
}

export interface ControllerConfigView {
  initialized: boolean;
  config: ProjectConfig | null;
  state: ProjectState | null;
}

export async function saveControllerConfig(input: ControllerConfigInput): Promise<ControllerConfigView> {
  const projectRoot = resolve(input.projectRoot);
  const goalDocumentPath = input.goalDocumentPath?.trim() ? resolve(input.goalDocumentPath) : undefined;
  const goal = goalDocumentPath ? await readGoalDocument(goalDocumentPath) : input.goal;

  await initProject({
    projectRoot,
    aggression: input.aggression,
    testCommands: parseCommandLines(input.testCommandsText),
    lintCommands: parseCommandLines(input.lintCommandsText),
    typecheckCommands: parseCommandLines(input.typecheckCommandsText),
    codexCommand: input.codexCommand.trim() || "codex",
    claudeCommand: input.claudeCommand?.trim() || undefined,
    goalDocumentPath,
    runDefaults: input.runDefaults,
    stallPolicy: input.stallPolicy
  });

  if (goal?.trim()) {
    await setProjectGoal(projectRoot, goal);
  }

  const config = await loadProjectConfig(projectRoot);
  await saveProjectConfig(projectRoot, {
    ...config,
    goalDocumentPath,
    runDefaults: input.runDefaults,
    stallPolicy: input.stallPolicy
  });

  return getControllerConfig(projectRoot);
}

export async function getControllerConfig(projectRoot: string): Promise<ControllerConfigView> {
  try {
    const [config, state] = await Promise.all([loadProjectConfig(projectRoot), loadProjectState(projectRoot)]);
    return { initialized: true, config, state };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { initialized: false, config: null, state: null };
    }
    throw error;
  }
}

export function parseCommandLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function readGoalDocument(filePath: string): Promise<string> {
  try {
    await access(filePath);
  } catch {
    throw new Error(`Goal document was not found: ${filePath}`);
  }

  const content = await readFile(filePath, "utf8");
  if (Buffer.byteLength(content, "utf8") > MAX_GOAL_DOCUMENT_BYTES) {
    throw new Error("Goal document is too large; keep it under 1MB");
  }
  return content;
}
```

- [ ] **Step 4: Run tests**

```powershell
npm test -- tests/controller/config.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/controller/config.ts tests/controller/config.test.ts src/core/project-state.ts src/core/types.ts
git commit -m "feat: add web controller config"
```

---

### Task 3: Add Durable Controller Record

**Files:**
- Create: `src/controller/record.ts`
- Create: `tests/controller/record.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/controller/record.test.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { initProject } from "../../src/core/project-state.js";
import { loadControllerRecord, updateControllerRecord } from "../../src/controller/record.js";

describe("controller record", () => {
  it("creates and updates the durable main controller record", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "gptauto-controller-record-"));
    try {
      await initProject({ projectRoot });
      const created = await updateControllerRecord(projectRoot, {
        mode: "idle",
        lastObservedRunId: null,
        lastRecoveryPackagePath: null
      });
      expect(created.id).toMatch(/^controller_/);
      expect(created.projectRoot).toBe(projectRoot);
      expect(created.mode).toBe("idle");
      expect(created.lastHeartbeatAt).toEqual(expect.any(String));

      const updated = await updateControllerRecord(projectRoot, {
        mode: "running",
        lastObservedRunId: "run_123",
        lastRecoveryPackagePath: "recovery.md"
      });
      expect(updated.id).toBe(created.id);
      expect(updated.createdAt).toBe(created.createdAt);
      expect(updated.mode).toBe("running");
      expect(updated.lastObservedRunId).toBe("run_123");

      await expect(loadControllerRecord(projectRoot)).resolves.toEqual(updated);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test and verify it fails**

```powershell
npm test -- tests/controller/record.test.ts
```

Expected: FAIL because `record.ts` does not exist.

- [ ] **Step 3: Implement `src/controller/record.ts`**

```ts
import { readFile } from "node:fs/promises";
import { writeJsonFile } from "../core/atomic-file.js";
import { getGptautoPaths } from "../core/paths.js";

export type ControllerMode = "idle" | "running" | "stopping" | "stalled" | "blocked";

export interface ControllerRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  projectRoot: string;
  mode: ControllerMode;
  lastHeartbeatAt: string;
  lastObservedRunId: string | null;
  lastRecoveryPackagePath: string | null;
}

export type ControllerRecordPatch = Pick<
  ControllerRecord,
  "mode" | "lastObservedRunId" | "lastRecoveryPackagePath"
>;

export async function loadControllerRecord(projectRoot: string): Promise<ControllerRecord | null> {
  try {
    return JSON.parse(await readFile(getGptautoPaths(projectRoot).controller, "utf8")) as ControllerRecord;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function updateControllerRecord(
  projectRoot: string,
  patch: ControllerRecordPatch
): Promise<ControllerRecord> {
  const existing = await loadControllerRecord(projectRoot);
  const now = new Date().toISOString();
  const next: ControllerRecord = {
    id: existing?.id ?? `controller_${now.replace(/[:.]/g, "-")}`,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    projectRoot,
    mode: patch.mode,
    lastHeartbeatAt: now,
    lastObservedRunId: patch.lastObservedRunId,
    lastRecoveryPackagePath: patch.lastRecoveryPackagePath
  };
  await writeJsonFile(getGptautoPaths(projectRoot).controller, next);
  return next;
}
```

- [ ] **Step 4: Run tests**

```powershell
npm test -- tests/controller/record.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/controller/record.ts tests/controller/record.test.ts src/core/paths.ts
git commit -m "feat: add durable controller record"
```

---

### Task 4: Add Stall Detection

**Files:**
- Create: `src/controller/stall.ts`
- Create: `tests/controller/stall.test.ts`

- [ ] **Step 1: Write failing pure stall detection tests**

Create `tests/controller/stall.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { analyzeStallStatus } from "../../src/controller/stall.js";

describe("analyzeStallStatus", () => {
  const now = new Date("2026-05-06T00:00:00.000Z");
  const policy = { activeTaskMinutes: 30, lockMinutes: 45, artifactMinutes: 30 };

  it("returns healthy when there is no active task and no lock", () => {
    expect(
      analyzeStallStatus({
        now,
        policy,
        activeTaskId: null,
        runLockCreatedAt: null,
        latestArtifactUpdatedAt: null,
        controllerRunActive: false
      })
    ).toEqual({ state: "healthy", reasons: [] });
  });

  it("returns suspected_stall when the active task is stale", () => {
    const result = analyzeStallStatus({
      now,
      policy,
      activeTaskId: "task_1",
      runLockCreatedAt: new Date("2026-05-05T23:50:00.000Z"),
      latestArtifactUpdatedAt: new Date("2026-05-05T23:20:00.000Z"),
      controllerRunActive: true
    });
    expect(result.state).toBe("suspected_stall");
    expect(result.reasons.join("\n")).toContain("No run artifact activity for 40 minutes");
  });

  it("returns stale_lock when the lock is older than the lock threshold", () => {
    const result = analyzeStallStatus({
      now,
      policy,
      activeTaskId: "task_1",
      runLockCreatedAt: new Date("2026-05-05T23:00:00.000Z"),
      latestArtifactUpdatedAt: new Date("2026-05-05T23:55:00.000Z"),
      controllerRunActive: false
    });
    expect(result.state).toBe("stale_lock");
    expect(result.reasons.join("\n")).toContain("Run lock is 60 minutes old");
  });
});
```

- [ ] **Step 2: Run test and verify it fails**

```powershell
npm test -- tests/controller/stall.test.ts
```

Expected: FAIL because `stall.ts` does not exist.

- [ ] **Step 3: Implement `src/controller/stall.ts`**

```ts
import type { StallPolicy } from "../core/types.js";

export type StallState = "healthy" | "watching" | "suspected_stall" | "stale_lock" | "needs_recovery";

export interface StallAnalysisInput {
  now: Date;
  policy: StallPolicy;
  activeTaskId: string | null;
  runLockCreatedAt: Date | null;
  latestArtifactUpdatedAt: Date | null;
  controllerRunActive: boolean;
}

export interface StallAnalysis {
  state: StallState;
  reasons: string[];
}

export function analyzeStallStatus(input: StallAnalysisInput): StallAnalysis {
  const reasons: string[] = [];
  const lockAge = ageMinutes(input.now, input.runLockCreatedAt);
  const artifactAge = ageMinutes(input.now, input.latestArtifactUpdatedAt);

  if (!input.activeTaskId && !input.runLockCreatedAt) {
    return { state: "healthy", reasons };
  }

  if (lockAge !== null && lockAge >= input.policy.lockMinutes && !input.controllerRunActive) {
    reasons.push(`Run lock is ${lockAge} minutes old and no web controller run owns it`);
    return { state: "stale_lock", reasons };
  }

  if (artifactAge !== null && artifactAge >= input.policy.artifactMinutes) {
    reasons.push(`No run artifact activity for ${artifactAge} minutes`);
    return { state: input.activeTaskId ? "suspected_stall" : "watching", reasons };
  }

  return { state: input.controllerRunActive || input.activeTaskId ? "watching" : "healthy", reasons };
}

function ageMinutes(now: Date, then: Date | null): number | null {
  if (!then) {
    return null;
  }
  return Math.floor((now.getTime() - then.getTime()) / 60000);
}
```

- [ ] **Step 4: Add file-backed status helper**

Extend `stall.ts` with a file-backed function:

```ts
export async function readRunLockCreatedAt(projectRoot: string): Promise<Date | null> {
  try {
    const raw = await readFile(getGptautoPaths(projectRoot).runLock, "utf8");
    const parsed = JSON.parse(raw) as { createdAt?: string };
    return parsed.createdAt ? new Date(parsed.createdAt) : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    return null;
  }
}
```

Add imports:

```ts
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { getGptautoPaths } from "../core/paths.js";
```

Add `findLatestArtifactUpdatedAt(projectRoot: string): Promise<Date | null>`:

```ts
export async function findLatestArtifactUpdatedAt(projectRoot: string): Promise<Date | null> {
  const paths = getGptautoPaths(projectRoot);
  const candidates = [paths.state, paths.decisions, paths.claudeSync];

  try {
    const runIds = await readdir(paths.runsDir);
    for (const runId of runIds) {
      const runDir = join(paths.runsDir, runId);
      candidates.push(
        join(runDir, "codex-output.md"),
        join(runDir, "verification.json"),
        join(runDir, "report.md"),
        join(runDir, "handoff.md")
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const mtimes = await Promise.all(candidates.map(statMtimeOrNull));
  return mtimes
    .filter((mtime): mtime is Date => mtime !== null)
    .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
}

async function statMtimeOrNull(filePath: string): Promise<Date | null> {
  try {
    return (await stat(filePath)).mtime;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}
```

- [ ] **Step 5: Run tests**

```powershell
npm test -- tests/controller/stall.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/controller/stall.ts tests/controller/stall.test.ts
git commit -m "feat: add controller stall detection"
```

---

### Task 5: Add Recovery Package Builder

**Files:**
- Create: `src/controller/recovery.ts`
- Create: `tests/controller/recovery.test.ts`

- [ ] **Step 1: Write failing recovery package test**

Create `tests/controller/recovery.test.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { appendClaudeSync } from "../../src/agents/claude-sync.js";
import { chooseOption } from "../../src/core/decisions.js";
import { initProject, setProjectGoal } from "../../src/core/project-state.js";
import { enqueueTask } from "../../src/core/task-queue.js";
import { buildRecoveryPackage } from "../../src/controller/recovery.js";

describe("buildRecoveryPackage", () => {
  it("collects durable state for stalled-run recovery", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "gptauto-recovery-"));
    try {
      await initProject({ projectRoot });
      await setProjectGoal(projectRoot, "Recover this project");
      const task = await enqueueTask(projectRoot, {
        title: "Implement recovery",
        source: "user",
        risk: "medium",
        contextFiles: ["src/recovery.ts"],
        acceptance: ["Recovery package exists"]
      });
      await chooseOption(projectRoot, {
        taskId: task.id,
        question: "Continue automatically?",
        options: ["yes", "no"],
        recommended: "yes",
        risk: "low",
        reversible: true,
        reason: "Routine recovery"
      });
      await appendClaudeSync(projectRoot, {
        type: "execution_report",
        summary: "Run needs Claude sync",
        changedFiles: ["src/recovery.ts"],
        nextPlanUsedWithoutClaude: false
      });

      const recovery = await buildRecoveryPackage(projectRoot, {
        changedFiles: async () => ["src/recovery.ts"]
      });

      expect(recovery.projectRoot).toBe(projectRoot);
      expect(recovery.goal).toBe("Recover this project");
      expect(recovery.queuedTasks).toEqual([expect.objectContaining({ title: "Implement recovery" })]);
      expect(recovery.changedFiles).toEqual(["src/recovery.ts"]);
      expect(recovery.recentEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ source: "decision" }),
          expect.objectContaining({ source: "claude-sync" })
        ])
      );
      expect(recovery.copyableText).toContain("Recover this project");
      expect(recovery.copyableText).toContain("src/recovery.ts");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test and verify it fails**

```powershell
npm test -- tests/controller/recovery.test.ts
```

Expected: FAIL because `recovery.ts` does not exist.

- [ ] **Step 3: Implement `src/controller/recovery.ts`**

```ts
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { listClaudeSync } from "../agents/claude-sync.js";
import { listDecisions } from "../core/decisions.js";
import { getGptautoPaths } from "../core/paths.js";
import { loadProjectConfig, loadProjectState } from "../core/project-state.js";
import { listTasks } from "../core/task-queue.js";
import type { Task } from "../core/types.js";
import { getChangedFiles } from "../verifier/git.js";

export interface RecoveryPackage {
  projectRoot: string;
  goal: string | null;
  goalDocumentPath: string | null;
  activeTaskId: string | null;
  lastRunId: string | null;
  queuedTasks: Task[];
  blockedTasks: Task[];
  repairTasks: Task[];
  changedFiles: string[];
  recentEvents: Array<{ source: "decision" | "claude-sync"; time: string; summary: string }>;
  latestReportPath: string | null;
  latestHandoffPath: string | null;
  suggestedNextAction: string;
  copyableText: string;
}

export async function buildRecoveryPackage(
  projectRoot: string,
  options: { changedFiles?: () => Promise<string[]> } = {}
): Promise<RecoveryPackage> {
  const [config, state, tasks, decisions, claudeSync, changedFiles] = await Promise.all([
    loadProjectConfig(projectRoot),
    loadProjectState(projectRoot),
    listTasks(projectRoot),
    listDecisions(projectRoot),
    listClaudeSync(projectRoot),
    (options.changedFiles ?? (() => getChangedFiles(projectRoot)))()
  ]);
  const recentEvents = [
    ...decisions.map((decision) => ({
      source: "decision" as const,
      time: decision.time,
      summary: `${decision.question} -> ${decision.choice}`
    })),
    ...claudeSync.map((record) => ({
      source: "claude-sync" as const,
      time: record.time,
      summary: record.summary
    }))
  ]
    .sort((left, right) => right.time.localeCompare(left.time))
    .slice(0, 10);

  const paths = getGptautoPaths(projectRoot);
  const latestReportPath = state.lastRunId ? join(paths.runsDir, state.lastRunId, "report.md") : null;
  const latestHandoffPath = state.lastRunId ? join(paths.runsDir, state.lastRunId, "handoff.md") : null;
  const repairTasks = tasks.queued.filter((task) => task.status === "repair_queued");
  const suggestedNextAction = tasks.blocked.length
    ? "Review blocked tasks and resolve safety stops"
    : repairTasks.length
      ? "Run or inspect the queued repair task"
      : "Continue with the next queued task";

  const recovery: Omit<RecoveryPackage, "copyableText"> = {
    projectRoot,
    goal: state.goal,
    goalDocumentPath: config.goalDocumentPath ?? null,
    activeTaskId: state.activeTaskId,
    lastRunId: state.lastRunId,
    queuedTasks: tasks.queued,
    blockedTasks: tasks.blocked,
    repairTasks,
    changedFiles,
    recentEvents,
    latestReportPath,
    latestHandoffPath,
    suggestedNextAction
  };
  const full = { ...recovery, copyableText: formatRecoveryText(recovery) };
  await writeFile(getGptautoPaths(projectRoot).recoveryPackage, full.copyableText, "utf8");
  return full;
}

function formatRecoveryText(input: Omit<RecoveryPackage, "copyableText">): string {
  return `# gptauto Recovery Package

Project: ${input.projectRoot}
Goal: ${input.goal ?? "No goal configured"}
Goal document: ${input.goalDocumentPath ?? "None"}
Active task: ${input.activeTaskId ?? "None"}
Last run: ${input.lastRunId ?? "None"}

Changed files:
${list(input.changedFiles)}

Queued tasks:
${list(input.queuedTasks.map((task) => `${task.id}: ${task.title}`))}

Blocked tasks:
${list(input.blockedTasks.map((task) => `${task.id}: ${task.title} - ${task.blocker ?? "blocked"}`))}

Recent events:
${list(input.recentEvents.map((event) => `${event.time} [${event.source}] ${event.summary}`))}

Suggested next action:
${input.suggestedNextAction}
`;
}

function list(items: string[]): string {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- None";
}
```

- [ ] **Step 4: Run tests**

```powershell
npm test -- tests/controller/recovery.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/controller/recovery.ts tests/controller/recovery.test.ts
git commit -m "feat: add recovery package builder"
```

---

### Task 6: Add Process-Local Controller Runtime

**Files:**
- Create: `src/controller/runtime.ts`
- Create: `tests/controller/runtime.test.ts`

- [ ] **Step 1: Write failing runtime tests**

Create `tests/controller/runtime.test.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { initProject, setProjectGoal } from "../../src/core/project-state.js";
import { createControllerRuntime } from "../../src/controller/runtime.js";

describe("controller runtime", () => {
  it("runs in the background and rejects concurrent starts", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "gptauto-runtime-"));
    try {
      await initProject({ projectRoot });
      await setProjectGoal(projectRoot, "Runtime goal");
      let release!: () => void;
      const runtime = createControllerRuntime({
        initialProjectRoot: projectRoot,
        runOnceImpl: async () => {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return { status: "completed", runId: "run_1", taskId: "task_1" };
        }
      });

      const first = await runtime.startRun({ maxTasks: 1, maxHours: 1, overnight: false });
      expect(first.mode).toBe("running");
      await expect(runtime.startRun({ maxTasks: 1, maxHours: 1, overnight: false })).rejects.toThrow(
        "A controller run is already active"
      );
      release();
      await runtime.waitForIdle();
      expect((await runtime.getStatus()).mode).toBe("idle");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("honors stop requests after the current iteration", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "gptauto-runtime-stop-"));
    try {
      await initProject({ projectRoot });
      await setProjectGoal(projectRoot, "Runtime stop goal");
      let calls = 0;
      const runtime = createControllerRuntime({
        initialProjectRoot: projectRoot,
        runOnceImpl: async () => {
          calls += 1;
          await runtime.requestStop();
          return { status: "completed", runId: `run_${calls}`, taskId: `task_${calls}` };
        }
      });

      await runtime.startRun({ maxTasks: 5, maxHours: 1, overnight: true });
      await runtime.waitForIdle();
      expect(calls).toBe(1);
      expect((await runtime.getStatus()).stopRequested).toBe(false);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test and verify it fails**

```powershell
npm test -- tests/controller/runtime.test.ts
```

Expected: FAIL because `runtime.ts` does not exist.

- [ ] **Step 3: Implement `src/controller/runtime.ts`**

```ts
import { loadProjectConfig } from "../core/project-state.js";
import { runOnce, type RunOnceResult } from "../core/run-loop.js";
import { updateControllerRecord } from "./record.js";

export interface ControllerRunOptions {
  maxTasks?: number;
  maxHours?: number;
  overnight?: boolean;
}

export interface ControllerStatus {
  projectRoot: string;
  mode: "idle" | "running" | "stopping" | "blocked";
  stopRequested: boolean;
  startedAt: string | null;
  lastActivityAt: string | null;
  lastResult: RunOnceResult | null;
}

export interface ControllerRuntimeOptions {
  initialProjectRoot: string;
  runOnceImpl?: typeof runOnce;
}

export interface ControllerRuntime {
  getProjectRoot(): string;
  setProjectRoot(projectRoot: string): void;
  getStatus(): Promise<ControllerStatus>;
  startRun(options: ControllerRunOptions): Promise<ControllerStatus>;
  requestStop(): Promise<ControllerStatus>;
  waitForIdle(): Promise<void>;
}

export function createControllerRuntime(options: ControllerRuntimeOptions): ControllerRuntime {
  let projectRoot = options.initialProjectRoot;
  const runOnceImpl = options.runOnceImpl ?? runOnce;
  let status: ControllerStatus = {
    projectRoot,
    mode: "idle",
    stopRequested: false,
    startedAt: null,
    lastActivityAt: null,
    lastResult: null
  };
  let activeRun: Promise<void> | null = null;

  async function startRun(runOptions: ControllerRunOptions): Promise<ControllerStatus> {
    if (activeRun) {
      throw new Error("A controller run is already active");
    }
    const config = await loadProjectConfig(projectRoot);
    const defaults = config.runDefaults ?? { maxTasks: 1, maxHours: 8, overnight: false };
    const maxTasks = runOptions.maxTasks ?? (runOptions.overnight ? 50 : defaults.maxTasks);
    const maxHours = runOptions.maxHours ?? defaults.maxHours;
    const deadline = Date.now() + maxHours * 60 * 60 * 1000;
    status = {
      ...status,
      projectRoot,
      mode: "running",
      stopRequested: false,
      startedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString()
    };
    await updateControllerRecord(projectRoot, {
      mode: "running",
      lastObservedRunId: status.lastResult?.runId ?? null,
      lastRecoveryPackagePath: null
    });

    activeRun = (async () => {
      try {
        for (let index = 0; index < maxTasks; index += 1) {
          if (status.stopRequested || Date.now() > deadline) {
            break;
          }
          const result = await runOnceImpl({ projectRoot });
          status = {
            ...status,
            lastActivityAt: new Date().toISOString(),
            lastResult: result
          };
          if (result.status === "blocked" || result.status === "repair_queued") {
            break;
          }
        }
      } finally {
        status = { ...status, mode: "idle", stopRequested: false };
        activeRun = null;
        await updateControllerRecord(projectRoot, {
          mode: "idle",
          lastObservedRunId: status.lastResult?.runId ?? null,
          lastRecoveryPackagePath: null
        });
      }
    })();

    void activeRun;
    return status;
  }

  return {
    getProjectRoot: () => projectRoot,
    setProjectRoot: (nextProjectRoot) => {
      projectRoot = nextProjectRoot;
      status = { ...status, projectRoot };
    },
    getStatus: async () => status,
    startRun,
    requestStop: async () => {
      status = { ...status, mode: activeRun ? "stopping" : status.mode, stopRequested: true };
      return status;
    },
    waitForIdle: async () => {
      await activeRun;
    }
  };
}
```

- [ ] **Step 4: Run tests**

```powershell
npm test -- tests/controller/runtime.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/controller/runtime.ts tests/controller/runtime.test.ts
git commit -m "feat: add web controller runtime"
```

---

### Task 7: Add Controller Web APIs

**Files:**
- Modify: `src/web/server.ts`
- Create: `tests/web/controller-api.test.ts`

- [ ] **Step 1: Write failing API tests**

Create `tests/web/controller-api.test.ts`:

```ts
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { getGptautoPaths } from "../../src/core/paths.js";
import { createWebServer } from "../../src/web/server.js";

const servers: Server[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        })
    )
  );
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("controller web api", () => {
  it("saves config and exposes controller status", async () => {
    const projectRoot = await tempProject();
    const baseUrl = await serve(projectRoot);

    const response = await fetch(`${baseUrl}/api/controller/config`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectRoot,
        aggression: "aggressive",
        codexCommand: "codex",
        testCommandsText: "npm test",
        lintCommandsText: "",
        typecheckCommandsText: "npm run typecheck",
        goal: "Configure from web",
        runDefaults: { maxTasks: 1, maxHours: 1, overnight: false },
        stallPolicy: { activeTaskMinutes: 30, lockMinutes: 45, artifactMinutes: 30 }
      })
    });

    expect(response.status).toBe(200);
    const saved = await response.json();
    expect(saved.initialized).toBe(true);
    expect(saved.state.goal).toBe("Configure from web");

    const status = await getJson(`${baseUrl}/api/controller/status`);
    expect(status.projectRoot).toBe(projectRoot);
    expect(status.controller.mode).toBe("idle");
    expect(status.queue).toEqual({ queued: 0, completed: 0, blocked: 0 });
    expect(status.stall.state).toBe("healthy");
  });

  it("saves goal from a goal document path", async () => {
    const projectRoot = await tempProject();
    const goalPath = join(projectRoot, "GOAL.md");
    await writeFile(goalPath, "Build from document", "utf8");
    const baseUrl = await serve(projectRoot);

    const response = await fetch(`${baseUrl}/api/controller/config`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectRoot,
        aggression: "balanced",
        codexCommand: "codex",
        testCommandsText: "npm test",
        lintCommandsText: "",
        typecheckCommandsText: "npm run typecheck",
        goalDocumentPath: goalPath,
        runDefaults: { maxTasks: 1, maxHours: 1, overnight: false },
        stallPolicy: { activeTaskMinutes: 30, lockMinutes: 45, artifactMinutes: 30 }
      })
    });

    expect(response.status).toBe(200);
    const saved = await response.json();
    expect(saved.state.goal).toBe("Build from document");
  });

  it("returns json errors without stack traces", async () => {
    const projectRoot = await tempProject();
    const baseUrl = await serve(projectRoot);
    const response = await fetch(`${baseUrl}/api/controller/config`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectRoot, aggression: "invalid" })
    });

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = await response.text();
    expect(body).toContain("error");
    expect(body).not.toContain("at ");
  });
});

async function tempProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "gptauto-controller-api-"));
  tempDirs.push(dir);
  return dir;
}

async function serve(projectRoot: string): Promise<string> {
  const app = createWebServer({ projectRoot });
  const server = app.listen(0);
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP address");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function getJson(url: string) {
  const response = await fetch(url);
  expect(response.status).toBe(200);
  return response.json();
}
```

- [ ] **Step 2: Run test and verify it fails**

```powershell
npm test -- tests/web/controller-api.test.ts
```

Expected: FAIL because `/api/controller/*` routes do not exist.

- [ ] **Step 3: Modify `src/web/server.ts`**

Add imports:

```ts
import { saveControllerConfig, getControllerConfig } from "../controller/config.js";
import { createControllerRuntime } from "../controller/runtime.js";
import { analyzeStallStatus, findLatestArtifactUpdatedAt, readRunLockCreatedAt } from "../controller/stall.js";
import { buildRecoveryPackage } from "../controller/recovery.js";
import { updateControllerRecord } from "../controller/record.js";
import { loadProjectConfig, loadProjectState } from "../core/project-state.js";
```

Create runtime inside `createWebServer()`:

```ts
const runtime = createControllerRuntime({ initialProjectRoot: options.projectRoot });
const projectRoot = () => runtime.getProjectRoot();
```

Change existing read APIs to use `projectRoot()` instead of `options.projectRoot`.

Add controller routes:

```ts
app.get("/api/controller/config", asyncHandler(async (_req, res) => {
  res.json(await getControllerConfig(projectRoot()));
}));

app.post("/api/controller/config", asyncHandler(async (req, res) => {
  const saved = await saveControllerConfig(parseControllerConfigBody(req.body));
  runtime.setProjectRoot(saved.config?.projectRoot ?? projectRoot());
  await updateControllerRecord(runtime.getProjectRoot(), {
    mode: "idle",
    lastObservedRunId: saved.state?.lastRunId ?? null,
    lastRecoveryPackagePath: null
  });
  res.json(saved);
}));

app.post("/api/controller/run", asyncHandler(async (req, res) => {
  res.json(await runtime.startRun(req.body ?? {}));
}));

app.post("/api/controller/stop", asyncHandler(async (_req, res) => {
  res.json(await runtime.requestStop());
}));

app.get("/api/controller/status", asyncHandler(async (_req, res) => {
  res.json(await buildControllerStatus(runtime));
}));

app.get("/api/controller/recovery-package", asyncHandler(async (_req, res) => {
  res.json(await buildRecoveryPackage(projectRoot()));
}));
```

Add a small validator:

```ts
function parseControllerConfigBody(body: unknown) {
  const input = body as Record<string, unknown>;
  if (typeof input.projectRoot !== "string" || !input.projectRoot.trim()) {
    throw new HttpError(400, "projectRoot is required");
  }
  if (!["conservative", "balanced", "aggressive"].includes(String(input.aggression))) {
    throw new HttpError(400, "aggression must be conservative, balanced, or aggressive");
  }
  return input as Parameters<typeof saveControllerConfig>[0];
}
```

Add `HttpError` and update `apiErrorHandler`:

```ts
class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}
```

Handler:

```ts
const statusCode = _error instanceof HttpError ? _error.statusCode : 500;
const message = _error instanceof HttpError ? _error.message : "Internal server error";
res.status(statusCode).json({ error: message });
```

Add `buildControllerStatus(runtime)` to combine runtime status, state, queue counts, stall status, latest recovery package path, and recent events.

- [ ] **Step 4: Run tests**

```powershell
npm test -- tests/web/controller-api.test.ts tests/web/server.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/web/server.ts tests/web/controller-api.test.ts
git commit -m "feat: add controller web api"
```

---

### Task 8: Build Web-First Static UI Layout

**Files:**
- Modify: `src/web/public/index.html`
- Modify: `src/web/public/styles.css`
- Modify: `tests/web/server.test.ts`

- [ ] **Step 1: Write failing static UI test**

Add to `tests/web/server.test.ts`:

```ts
it("serves the web-first controller sections", async () => {
  const projectRoot = await makeProject();
  const baseUrl = await listen(projectRoot);
  const response = await fetch(`${baseUrl}/`);
  const html = await response.text();
  expect(html).toContain("Project Setup");
  expect(html).toContain("Run Control");
  expect(html).toContain("Stall Monitor");
  expect(html).toContain("Recovery Package");
});
```

- [ ] **Step 2: Run test and verify it fails**

```powershell
npm test -- tests/web/server.test.ts
```

Expected: FAIL because these sections are not present yet.

- [ ] **Step 3: Replace `index.html` with controller layout**

Keep the document simple and operational. Required IDs:

```html
<section class="panel setup-panel">
  <h2>Project Setup</h2>
  <form id="config-form">
    <label>Project path <input id="project-root" name="projectRoot" required /></label>
    <label>Goal document path <input id="goal-document-path" name="goalDocumentPath" /></label>
    <label>Goal <textarea id="goal" name="goal"></textarea></label>
    <label>Aggression
      <select id="aggression" name="aggression">
        <option value="balanced">Balanced</option>
        <option value="aggressive">Aggressive</option>
        <option value="conservative">Conservative</option>
      </select>
    </label>
    <label>Codex command <input id="codex-command" value="codex" /></label>
    <label>Claude command <input id="claude-command" /></label>
    <label>Test commands <textarea id="test-commands">npm test</textarea></label>
    <label>Typecheck commands <textarea id="typecheck-commands">npm run typecheck</textarea></label>
    <label>Lint commands <textarea id="lint-commands"></textarea></label>
    <label>Max tasks <input id="max-tasks" type="number" min="1" value="1" /></label>
    <label>Max hours <input id="max-hours" type="number" min="1" value="8" /></label>
    <button id="save-config" type="submit">Save Config</button>
  </form>
</section>

<section class="panel">
  <h2>Run Control</h2>
  <button id="run-once" type="button">Run One</button>
  <button id="run-overnight" type="button">Run Overnight</button>
  <button id="stop-run" type="button">Stop After Current Run</button>
  <pre id="controller-status"></pre>
</section>

<section class="panel">
  <h2>Stall Monitor</h2>
  <div id="stall-state"></div>
  <ul id="stall-reasons"></ul>
</section>

<section class="panel">
  <h2>Recovery Package</h2>
  <button id="refresh-recovery" type="button">Build Recovery Package</button>
  <pre id="recovery-package"></pre>
</section>
```

Keep existing task/decision/Claude sync sections below these panels.

- [ ] **Step 4: Update CSS**

Use a dense work-console style:

```css
.panel {
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
  padding: 16px;
}

form {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 12px;
}

label {
  display: grid;
  gap: 6px;
  font-size: 13px;
  color: #334155;
}

input,
select,
textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 8px 10px;
  font: inherit;
}
```

- [ ] **Step 5: Run tests**

```powershell
npm test -- tests/web/server.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/web/public/index.html src/web/public/styles.css tests/web/server.test.ts
git commit -m "feat: add web controller layout"
```

---

### Task 9: Add Web Client Controller Behavior

**Files:**
- Modify: `src/web/public/app.js`
- Test: `tests/web/controller-api.test.ts`

- [ ] **Step 1: Add API smoke expectations**

Extend `tests/web/controller-api.test.ts` with:

```ts
it("serves controller client script references", async () => {
  const projectRoot = await tempProject();
  const baseUrl = await serve(projectRoot);
  const html = await (await fetch(`${baseUrl}/`)).text();
  const script = await (await fetch(`${baseUrl}/app.js`)).text();
  expect(html).toContain('id="config-form"');
  expect(script).toContain("/api/controller/config");
  expect(script).toContain("/api/controller/run");
  expect(script).toContain("/api/controller/recovery-package");
});
```

- [ ] **Step 2: Run test and verify it fails**

```powershell
npm test -- tests/web/controller-api.test.ts
```

Expected: FAIL until `app.js` uses the controller APIs.

- [ ] **Step 3: Update `app.js`**

Add form and button handlers:

```js
const controllerNodes = {
  form: document.querySelector("#config-form"),
  projectRoot: document.querySelector("#project-root"),
  goalDocumentPath: document.querySelector("#goal-document-path"),
  goal: document.querySelector("#goal"),
  aggression: document.querySelector("#aggression"),
  codexCommand: document.querySelector("#codex-command"),
  claudeCommand: document.querySelector("#claude-command"),
  testCommands: document.querySelector("#test-commands"),
  lintCommands: document.querySelector("#lint-commands"),
  typecheckCommands: document.querySelector("#typecheck-commands"),
  maxTasks: document.querySelector("#max-tasks"),
  maxHours: document.querySelector("#max-hours"),
  runOnce: document.querySelector("#run-once"),
  runOvernight: document.querySelector("#run-overnight"),
  stopRun: document.querySelector("#stop-run"),
  controllerStatus: document.querySelector("#controller-status"),
  stallState: document.querySelector("#stall-state"),
  stallReasons: document.querySelector("#stall-reasons"),
  refreshRecovery: document.querySelector("#refresh-recovery"),
  recoveryPackage: document.querySelector("#recovery-package")
};
```

Add JSON helpers:

```js
async function postJson(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `${path} returned ${response.status}`);
  }
  return payload;
}
```

Save config:

```js
controllerNodes.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await postJson("/api/controller/config", readConfigForm());
  await loadConsole();
  await loadControllerStatus();
});

function readConfigForm() {
  return {
    projectRoot: controllerNodes.projectRoot.value,
    aggression: controllerNodes.aggression.value,
    codexCommand: controllerNodes.codexCommand.value || "codex",
    claudeCommand: controllerNodes.claudeCommand.value || undefined,
    testCommandsText: controllerNodes.testCommands.value,
    lintCommandsText: controllerNodes.lintCommands.value,
    typecheckCommandsText: controllerNodes.typecheckCommands.value,
    goal: controllerNodes.goal.value || undefined,
    goalDocumentPath: controllerNodes.goalDocumentPath.value || undefined,
    runDefaults: {
      maxTasks: Number(controllerNodes.maxTasks.value || 1),
      maxHours: Number(controllerNodes.maxHours.value || 8),
      overnight: false
    },
    stallPolicy: { activeTaskMinutes: 30, lockMinutes: 45, artifactMinutes: 30 }
  };
}
```

Run controls:

```js
controllerNodes.runOnce.addEventListener("click", async () => {
  await postJson("/api/controller/run", { maxTasks: 1, maxHours: Number(controllerNodes.maxHours.value || 8), overnight: false });
  startPolling();
});

controllerNodes.runOvernight.addEventListener("click", async () => {
  await postJson("/api/controller/run", {
    maxTasks: Number(controllerNodes.maxTasks.value || 50),
    maxHours: Number(controllerNodes.maxHours.value || 8),
    overnight: true
  });
  startPolling();
});

controllerNodes.stopRun.addEventListener("click", async () => {
  await postJson("/api/controller/stop", {});
  await loadControllerStatus();
});
```

Status/recovery:

```js
async function loadControllerStatus() {
  const status = await getJson("/api/controller/status");
  controllerNodes.controllerStatus.textContent = JSON.stringify(status.controller, null, 2);
  controllerNodes.stallState.textContent = status.stall.state;
  controllerNodes.stallReasons.replaceChildren(...status.stall.reasons.map((reason) => {
    const item = document.createElement("li");
    item.textContent = reason;
    return item;
  }));
}

controllerNodes.refreshRecovery.addEventListener("click", async () => {
  const recovery = await getJson("/api/controller/recovery-package");
  controllerNodes.recoveryPackage.textContent = recovery.copyableText;
});
```

Polling:

```js
let pollTimer = null;

function startPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
  }
  pollTimer = setInterval(async () => {
    await loadConsole();
    await loadControllerStatus();
    if (state.controller?.mode === "idle") {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }, 5000);
}
```

If `state.controller` is not part of existing state, set it inside `loadControllerStatus()`.

- [ ] **Step 4: Run tests**

```powershell
npm test -- tests/web/controller-api.test.ts tests/web/server.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/web/public/app.js tests/web/controller-api.test.ts
git commit -m "feat: wire web controller client"
```

---

### Task 10: Add Stale Lock Recovery Endpoint

**Files:**
- Modify: `src/web/server.ts`
- Modify: `src/controller/stall.ts`
- Test: `tests/web/controller-api.test.ts`

- [ ] **Step 1: Write failing stale-lock endpoint test**

Add to `tests/web/controller-api.test.ts`:

```ts
it("requires confirmation before clearing stale locks", async () => {
  const projectRoot = await tempProject();
  const baseUrl = await serve(projectRoot);
  await fetch(`${baseUrl}/api/controller/config`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      projectRoot,
      aggression: "balanced",
      codexCommand: "codex",
      testCommandsText: "npm test",
      lintCommandsText: "",
      typecheckCommandsText: "npm run typecheck",
      goal: "Clear lock",
      runDefaults: { maxTasks: 1, maxHours: 1, overnight: false },
      stallPolicy: { activeTaskMinutes: 1, lockMinutes: 1, artifactMinutes: 1 }
    })
  });

  const denied = await fetch(`${baseUrl}/api/controller/recover/clear-stale-lock`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  });
  expect(denied.status).toBe(400);
});

it("clears an old run lock only after explicit confirmation", async () => {
  const projectRoot = await tempProject();
  const baseUrl = await serve(projectRoot);
  await fetch(`${baseUrl}/api/controller/config`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      projectRoot,
      aggression: "balanced",
      codexCommand: "codex",
      testCommandsText: "npm test",
      lintCommandsText: "",
      typecheckCommandsText: "npm run typecheck",
      goal: "Clear old lock",
      runDefaults: { maxTasks: 1, maxHours: 1, overnight: false },
      stallPolicy: { activeTaskMinutes: 1, lockMinutes: 1, artifactMinutes: 1 }
    })
  });
  const lockPath = getGptautoPaths(projectRoot).runLock;
  await writeFile(lockPath, JSON.stringify({ pid: 999999, createdAt: "2026-05-05T00:00:00.000Z" }), "utf8");

  const confirmed = await fetch(`${baseUrl}/api/controller/recover/clear-stale-lock`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirm: "clear stale lock" })
  });

  expect(confirmed.status).toBe(200);
  await expect(confirmed.json()).resolves.toEqual({ cleared: true });
  await expect(readFile(lockPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
});
```

- [ ] **Step 2: Run test and verify it fails**

```powershell
npm test -- tests/web/controller-api.test.ts
```

Expected: FAIL because endpoint does not exist.

- [ ] **Step 3: Implement endpoint**

In `src/controller/stall.ts`, add:

```ts
export async function clearStaleRunLock(projectRoot: string, policy: StallPolicy, confirm: string): Promise<{ cleared: boolean }> {
  if (confirm !== "clear stale lock") {
    throw new Error("Confirmation is required to clear a stale lock");
  }
  const createdAt = await readRunLockCreatedAt(projectRoot);
  if (!createdAt) {
    return { cleared: false };
  }
  const analysis = analyzeStallStatus({
    now: new Date(),
    policy,
    activeTaskId: null,
    runLockCreatedAt: createdAt,
    latestArtifactUpdatedAt: null,
    controllerRunActive: false
  });
  if (analysis.state !== "stale_lock") {
    return { cleared: false };
  }
  await rm(getGptautoPaths(projectRoot).runLock, { force: true });
  return { cleared: true };
}
```

In `src/web/server.ts`, add:

```ts
app.post("/api/controller/recover/clear-stale-lock", asyncHandler(async (req, res) => {
  const config = await loadProjectConfig(projectRoot());
  try {
    res.json(await clearStaleRunLock(projectRoot(), config.stallPolicy ?? DEFAULT_STALL_POLICY, req.body?.confirm));
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Could not clear stale lock");
  }
}));
```

- [ ] **Step 4: Run tests**

```powershell
npm test -- tests/web/controller-api.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/controller/stall.ts src/web/server.ts tests/web/controller-api.test.ts
git commit -m "feat: add stale lock recovery api"
```

---

### Task 11: Update README and CLI/Web Smoke

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README**

Add a "Web-first setup" section:

```md
## Web-First Setup

```powershell
npm install
npm run build
node dist/cli/index.js web --project E:\some-project --port 4789
```

Open `http://localhost:4789/` and use the Project Setup panel to configure:

- project path
- direct goal or goal document path
- Codex and optional Claude commands
- test, typecheck, and lint commands
- overnight run defaults

The web console is the main controller surface. It stores durable controller state in `.gptauto/controller.json` and can generate a recovery package if a run appears stalled.
```

Mention that context-compaction stalls are detected from external signals, not from hidden Codex internals.

- [ ] **Step 2: Run full verification**

```powershell
npm test
npm run typecheck
npm run build
```

Expected: all pass.

- [ ] **Step 3: Run web-first smoke**

Use a temp project and run:

```powershell
node dist/cli/index.js web --project <temp-project> --port <free-port>
```

Then exercise:

```powershell
curl.exe -fsS http://127.0.0.1:<free-port>/api/controller/status
curl.exe -fsS -X POST http://127.0.0.1:<free-port>/api/controller/config `
  -H "content-type: application/json" `
  --data "{\"projectRoot\":\"<temp-project>\",\"aggression\":\"aggressive\",\"codexCommand\":\"codex\",\"testCommandsText\":\"npm test\",\"lintCommandsText\":\"\",\"typecheckCommandsText\":\"npm run typecheck\",\"goal\":\"Smoke goal\",\"runDefaults\":{\"maxTasks\":1,\"maxHours\":1,\"overnight\":false},\"stallPolicy\":{\"activeTaskMinutes\":30,\"lockMinutes\":45,\"artifactMinutes\":30}}"
curl.exe -fsS http://127.0.0.1:<free-port>/api/controller/recovery-package
```

Expected: all return JSON; config response includes `initialized: true`.

- [ ] **Step 4: Clean build artifacts**

```powershell
if (Test-Path dist) { Remove-Item -Recurse -Force -LiteralPath dist }
git status --short
```

Expected: no tracked changes except README before commit.

- [ ] **Step 5: Commit**

```powershell
git add README.md
git commit -m "docs: document web-first controller"
```

---

### Task 12: Final Review and Push

**Files:**
- No expected source changes unless review finds a blocker.

- [ ] **Step 1: Request final code review**

Ask a reviewer to inspect all changes since `3f82c97` with focus on:

- config save safety
- controller runtime concurrency
- stall detection correctness
- recovery package accuracy
- API error leakage
- web UI usability

- [ ] **Step 2: Fix any Critical or Important findings**

If findings exist, add failing tests first, fix, run targeted tests, and commit.

- [ ] **Step 3: Final verification**

Run:

```powershell
npm test
npm run typecheck
npm run build
```

Expected:

- all test files pass
- typecheck exits 0
- build exits 0

- [ ] **Step 4: Final smoke**

Run the web-first smoke from Task 11 again against `dist/cli/index.js`.

- [ ] **Step 5: Push**

```powershell
if (Test-Path dist) { Remove-Item -Recurse -Force -LiteralPath dist }
git status --short
git push origin main
```

Expected:

- no tracked changes
- GitHub `main` contains the web-first controller implementation.

---

## Self-Review

Spec coverage:

- Web configuration is covered by Tasks 1, 2, 7, 8, and 9.
- Main controller record is covered by Task 3.
- Run start/stop control is covered by Task 6 and Task 7.
- Stall detection is covered by Task 4 and Task 10.
- Recovery package is covered by Task 5 and surfaced in Tasks 7 and 9.
- UI setup/control/recovery sections are covered by Tasks 8 and 9.
- README and final smoke are covered by Task 11.

Placeholder scan:

- No `TBD`, `TODO`, or undefined implementation placeholders are intentionally left in the plan.

Type consistency:

- `RunDefaults`, `StallPolicy`, and `ProjectConfig` additions are introduced before they are used.
- `ControllerRuntime`, `ControllerRecord`, `StallAnalysis`, and `RecoveryPackage` are introduced in their owning tasks before web routes consume them.
