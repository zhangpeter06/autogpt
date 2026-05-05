export type Aggression = "conservative" | "balanced" | "aggressive";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type TaskSource = "user" | "claude" | "codex" | "local" | "repair";
export type TaskStatus =
  | "queued"
  | "planning"
  | "ready"
  | "running"
  | "verifying"
  | "completed"
  | "repair_queued"
  | "blocked"
  | "cancelled";

export interface ProjectConfig {
  projectRoot: string;
  aggression: Aggression;
  testCommands: string[];
  lintCommands: string[];
  typecheckCommands: string[];
  codexCommand: string;
  claudeCommand?: string;
}

export interface ProjectState {
  version: 1;
  goal: string | null;
  activeTaskId: string | null;
  lastRunId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  project: string;
  title: string;
  source: TaskSource;
  status: TaskStatus;
  risk: RiskLevel;
  attempts: number;
  maxAttempts: number;
  requiresApproval: boolean;
  contextFiles: string[];
  acceptance: string[];
  createdAt: string;
  updatedAt: string;
  parentTaskId?: string;
  blocker?: string;
}

export interface DecisionRecord {
  time: string;
  taskId: string | null;
  question: string;
  choice: string;
  reason: string;
  risk: RiskLevel;
  reversible: boolean;
  approvedBy: string;
}

export interface CommandResult {
  command: string;
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface VerificationResult {
  ok: boolean;
  commands: CommandResult[];
  risk: RiskLevel;
  findings: string[];
}

export interface RunRecord {
  id: string;
  taskId: string;
  startedAt: string;
  finishedAt: string;
  status: "completed" | "repair_queued" | "blocked";
  reportPath: string;
  handoffPath: string;
}
