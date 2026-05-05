# gptauto Web-First Controller Design

## Goal

Make gptauto usable from one local web console so the user does not need to configure projects through CLI commands. The console should configure the target project, accept the project goal or goal document, start and monitor unattended runs, detect likely context-compaction stalls, and provide one main controller surface for recovery.

## Current State

The first implementation provides a working local orchestrator:

- CLI commands: `init`, `goal`, `run`, `status`, `web`.
- Persistent state under `.gptauto/`.
- Task queue, run reports, handoffs, decisions, Claude sync records, verifier, run lock, and dirty-worktree safety stop.
- A read-only web console for dashboard counts, tasks, decisions, and Claude sync.

The remaining usability gap is that setup and operation still require command-line steps, and the web console does not yet act as the single control plane.

## Design Choice

Use a Web-first controller inside the existing Express server. Keep the CLI as a fallback and scripting interface, but make the browser the normal way to configure and run a project.

Rejected alternatives:

- **CLI-only with better prompts:** lower implementation effort, but does not solve the user's stated friction.
- **Separate desktop app:** better long-term packaging, but too much surface area for this stage.
- **Cloud service:** easier remote monitoring, but conflicts with the local-first safety model and introduces credential risk.

## User Experience

The web console becomes a control center with three modes:

1. **Setup**
   - Enter or browse-style paste the project path.
   - Choose automation aggression.
   - Configure Codex command and optional Claude command.
   - Configure test/typecheck/lint commands.
   - Provide the project goal directly or load a local goal document path.
   - Save configuration and initialize `.gptauto/`.

2. **Control**
   - Show current project path, goal summary, active task, last run, queue counts, and safety status.
   - Start one run, start overnight run, or stop after current run.
   - Show latest run result and direct links/paths to report and handoff files.

3. **Recovery**
   - Detect likely stalled runs.
   - Show why gptauto thinks the run is stalled.
   - Show a recovery package containing project goal, active task, last run id, changed files, recent events, handoff path, and suggested next action.
   - Let the user mark a stale lock cleared after explicit confirmation.

The first version supports one active project per running web server. Multi-project switching is outside this version.

## Configuration Model

Extend the current config/state model without replacing it.

`.gptauto/config.json` remains the durable source for:

- `projectRoot`
- `aggression`
- `testCommands`
- `lintCommands`
- `typecheckCommands`
- `codexCommand`
- `claudeCommand`

Add optional fields:

- `goalDocumentPath`: local path used to populate the goal.
- `runDefaults`: default `maxTasks`, `maxHours`, and `overnight` values for web-triggered runs.
- `stallPolicy`: thresholds for detecting stale activity.

The server also needs a lightweight process-local controller state:

- current run status: `idle`, `running`, `stopping`, `stalled`, or `blocked`
- current child process/run promise metadata
- last activity timestamp
- stop requested flag

This process state should not replace `.gptauto/`; it only coordinates the currently running web server.

## Web API

Add write APIs under `/api/controller/*`:

- `GET /api/controller/config`
  - Reads current config, project state, and whether `.gptauto/` is initialized.

- `POST /api/controller/config`
  - Validates and saves configuration.
  - Initializes `.gptauto/` idempotently.
  - If `goalDocumentPath` is provided, reads the document and saves it as the project goal.
  - If direct `goal` is provided, saves that as the project goal.

- `POST /api/controller/run`
  - Starts a background run loop using the saved config/defaults or request overrides.
  - Rejects if another run is active.
  - Returns immediately with controller status.

- `POST /api/controller/stop`
  - Requests stop after the current `runOnce` finishes.

- `GET /api/controller/status`
  - Returns controller status, project state, queue summary, last activity, lock status, stall status, recent events, and latest handoff/report paths.

- `POST /api/controller/recover/clear-stale-lock`
  - Clears `.gptauto/locks/run.lock` only when the lock is older than the configured stale threshold.
  - Requires an explicit confirmation field, for example `{ "confirm": "clear stale lock" }`.

Existing read APIs remain:

- `/api/dashboard`
- `/api/tasks`
- `/api/decisions`
- `/api/claude-sync`

## Stall Detection

gptauto cannot directly observe Codex's internal context-compaction state. It should detect stalls from external evidence.

Signals:

- `.gptauto/state.json.activeTaskId` has been set longer than `stallPolicy.activeTaskMinutes`.
- `.gptauto/locks/run.lock` is older than `stallPolicy.lockMinutes`.
- The latest run directory has no recently modified files.
- No new Claude sync, decision, report, handoff, or verification record has appeared recently.
- A web-started controller run promise has not produced a status update within the threshold.

Default thresholds:

- active task stale after 30 minutes
- run lock stale after 45 minutes
- no artifact activity after 30 minutes

Stall states:

- `healthy`: recent activity or no active run.
- `watching`: run active, no issue yet.
- `suspected_stall`: threshold crossed but lock/process may still be valid.
- `stale_lock`: lock is old and no controller process owns it.
- `needs_recovery`: run artifacts show incomplete state, active task remains set, and no activity is recent.

The UI should describe evidence, not claim certainty. Example: "Likely stalled: active task unchanged for 47 minutes and no run artifacts updated for 42 minutes."

## Recovery Package

Generate recovery data from durable state:

- project root
- goal or goal document path
- active task id/title
- last run id
- latest report path
- latest handoff path
- blocked tasks
- queued repair tasks
- changed files from git
- recent decisions and Claude sync records
- suggested next action

Expose it through:

- `GET /api/controller/recovery-package`

The UI shows this package as copyable text and as structured fields. Seeding a new Codex/Claude conversation is outside this version; this version only generates the recovery package.

## Main Controller Conversation

The project should model a "main controller" as a durable local controller record, not as a fragile chat thread.

Add `.gptauto/controller.json`:

- `id`
- `createdAt`
- `updatedAt`
- `projectRoot`
- `mode`
- `lastHeartbeatAt`
- `lastObservedRunId`
- `lastRecoveryPackagePath`

The browser page is the main controller surface. Codex/Claude chat threads can come and go; the controller record and recovery package keep the durable coordination state.

## Error Handling and Safety

- Config writes must be atomic.
- Project path must be absolute after resolution.
- Goal document reads must fail with a clear JSON error if the file is missing or too large.
- Web run start must reject if `run.lock` or controller state indicates an active run.
- Dirty-worktree safety remains enforced by `runOnce`.
- Clearing stale locks must require confirmation and must not delete active process-owned locks.
- API errors should return minimal JSON without stack traces or local path leakage.

## UI Design

Keep the UI operational and dense, not a landing page.

Views:

- Setup panel
- Goal editor/document panel
- Run controls
- Health/stall monitor
- Queue panel
- Reports/handoff panel
- Claude sync panel

Controls:

- Text inputs for project path and commands.
- Textarea for direct goal.
- Numeric inputs for max tasks/max hours.
- Segmented/select control for aggression.
- Buttons for save config, start one run, start overnight, request stop, refresh, clear stale lock.

The page should poll `/api/controller/status` every 5 seconds while a run is active.

## Testing

Add tests for:

- Saving config initializes `.gptauto/` and preserves existing recovery state.
- Saving a goal from direct text.
- Saving a goal from a local document path.
- Starting a controller run rejects concurrent starts.
- Stop request halts after current iteration.
- Stall detector returns `healthy`, `suspected_stall`, and `stale_lock` for controlled timestamps.
- Recovery package contains goal, active task, last run, changed files, and recent events.
- API errors stay JSON and do not leak stack traces.
- Static UI serves and includes setup/control sections.

Run full verification:

- `npm test`
- `npm run typecheck`
- `npm run build`
- smoke `node dist/cli/index.js web` and exercise controller endpoints.

## Out of Scope

- Real browser file picker access to arbitrary local paths. The first version accepts typed/pasted local paths.
- Spawning new Codex app conversations directly.
- Full Claude API integration. This version records sync handoffs and stores the configured Claude command for a future integration.
- Multi-project dashboard.
- Authentication. This remains a localhost tool.

## Success Criteria

- A user can open the web page, configure a project path and goal, save, start a run, and monitor status without using CLI commands.
- The web page shows whether a run is healthy, blocked, or likely stalled.
- A likely context-compaction stall produces a recovery package from durable local state.
- The system has a durable main controller record under `.gptauto/`.
- Existing CLI workflows and tests continue to pass.
