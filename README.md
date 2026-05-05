# gptauto

gptauto is a local agentic development orchestrator that stores task state, run records, reports, handoffs, and decisions in `.gptauto/` so work can resume after context interruptions.

## Quick Start

Install dependencies and build the CLI:

```powershell
npm install
npm run build
```

Initialize gptauto for a project:

```powershell
node dist/cli/index.js init --project E:\some-project --aggression aggressive
```

Set a goal:

```powershell
node dist/cli/index.js goal "Build the app according to the README" --project E:\some-project
```

Start the web console:

```powershell
node dist/cli/index.js web --project E:\some-project --port 4789
```

Run one task loop:

```powershell
node dist/cli/index.js run --project E:\some-project --max-tasks 1
```

## Commands

- `init` creates `.gptauto/` state, task, run, decision, report, and lock files for the target project.
- `goal` saves the project goal used by the local planner.
- `status` prints JSON with project state, queue counts, and recent decision or Claude sync events.
- `run` plans work when the queue is empty, then executes queued work through the configured Codex command and verifier.
- `web` starts the local dashboard for viewing state, queue, runs, and recent events.

## Safety Stops

Aggressive mode increases automation, but gptauto still pauses for critical risks. These include secret edits, production deployment, paid API activation, large migrations, git history rewrite, and unclear ownership of uncommitted user changes.

## `.gptauto/` Layout

- `config.json` stores project root, aggression level, verification commands, and agent commands.
- `state.json` stores the active goal, active task, last run, and timestamps.
- `tasks/` stores queued, completed, and blocked task JSONL records.
- `runs/` stores per-run Codex output, verification results, reports, and handoffs.
- `decisions/` stores decision records.
- `reports/` stores cross-agent sync records.
- `locks/` stores run coordination locks.

## Current Limits

- Planning currently starts with a single local implementation-step task derived from the saved goal.
- The runtime expects the configured Codex command to be available when executing queued tasks.
- Verification uses the commands stored in `.gptauto/config.json`, which default to `npm test` and `npm run typecheck`.
