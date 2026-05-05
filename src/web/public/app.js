const state = {
  dashboard: null,
  tasks: null,
  decisions: [],
  claudeSync: []
};

const nodes = {
  refresh: document.querySelector("#refresh"),
  status: document.querySelector("#status"),
  queuedCount: document.querySelector("#queued-count"),
  completedCount: document.querySelector("#completed-count"),
  blockedCount: document.querySelector("#blocked-count"),
  tasksSummary: document.querySelector("#tasks-summary"),
  tasksList: document.querySelector("#tasks-list"),
  decisionsSummary: document.querySelector("#decisions-summary"),
  decisionsList: document.querySelector("#decisions-list"),
  claudeSyncSummary: document.querySelector("#claude-sync-summary"),
  claudeSyncList: document.querySelector("#claude-sync-list")
};

nodes.refresh.addEventListener("click", () => {
  void loadConsole();
});

void loadConsole();

async function loadConsole() {
  setStatus("Loading");
  nodes.refresh.disabled = true;
  try {
    const [dashboard, tasks, decisions, claudeSync] = await Promise.all([
      getJson("/api/dashboard"),
      getJson("/api/tasks"),
      getJson("/api/decisions"),
      getJson("/api/claude-sync")
    ]);
    state.dashboard = dashboard;
    state.tasks = tasks;
    state.decisions = decisions;
    state.claudeSync = claudeSync;
    render();
    setStatus(`Updated ${new Date().toLocaleTimeString()}`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Failed to load console data", true);
  } finally {
    nodes.refresh.disabled = false;
  }
}

async function getJson(path) {
  const response = await fetch(path, {
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}`);
  }
  return response.json();
}

function render() {
  nodes.queuedCount.textContent = String(state.dashboard.queued);
  nodes.completedCount.textContent = String(state.dashboard.completed);
  nodes.blockedCount.textContent = String(state.dashboard.blocked);
  renderTasks();
  renderDecisions();
  renderClaudeSync();
}

function renderTasks() {
  const groups = [
    ["Queued", state.tasks.queued],
    ["Completed", state.tasks.completed],
    ["Blocked", state.tasks.blocked]
  ];
  const total = groups.reduce((sum, [, tasks]) => sum + tasks.length, 0);
  nodes.tasksSummary.textContent = `${total} total`;
  nodes.tasksList.replaceChildren(
    ...groups.flatMap(([label, tasks]) => {
      if (tasks.length === 0) {
        return [];
      }
      return [
        sectionLabel(label),
        ...tasks.map((task) =>
          item(
            task.title,
            `${task.status} · ${task.risk} risk · attempts ${task.attempts}/${task.maxAttempts}`,
            task.blocker ?? task.acceptance?.join("; ") ?? ""
          )
        )
      ];
    })
  );
  renderEmpty(nodes.tasksList, total, "No tasks recorded.");
}

function renderDecisions() {
  nodes.decisionsSummary.textContent = `${state.decisions.length} records`;
  nodes.decisionsList.replaceChildren(
    ...state.decisions.map((decision) =>
      item(decision.question, `${decision.choice} · ${decision.risk} risk`, decision.reason)
    )
  );
  renderEmpty(nodes.decisionsList, state.decisions.length, "No decisions recorded.");
}

function renderClaudeSync() {
  nodes.claudeSyncSummary.textContent = `${state.claudeSync.length} records`;
  nodes.claudeSyncList.replaceChildren(
    ...state.claudeSync.map((record) =>
      item(record.summary, `${record.type} · ${record.status}`, record.changedFiles.join(", ") || "No changed files")
    )
  );
  renderEmpty(nodes.claudeSyncList, state.claudeSync.length, "No Claude sync records.");
}

function item(title, meta, detail) {
  const element = document.createElement("article");
  element.className = "item";
  const heading = document.createElement("h3");
  heading.textContent = title;
  const metaElement = document.createElement("p");
  metaElement.className = "meta";
  metaElement.textContent = meta;
  const detailElement = document.createElement("p");
  detailElement.textContent = detail;
  element.append(heading, metaElement, detailElement);
  return element;
}

function sectionLabel(text) {
  const label = document.createElement("h3");
  label.className = "section-label";
  label.textContent = text;
  return label;
}

function renderEmpty(container, count, message) {
  if (count > 0) {
    return;
  }
  const empty = document.createElement("p");
  empty.className = "empty";
  empty.textContent = message;
  container.append(empty);
}

function setStatus(message, error = false) {
  nodes.status.textContent = message;
  nodes.status.classList.toggle("error", error);
}
