// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { PI_WEB_CAPABILITIES } from "../../../shared/capabilities";
import type { LocalSessionDashboardSessionSummary } from "../../../shared/sessionDashboard";
import { SessionDashboard } from "./SessionDashboard";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("SessionDashboard compact card actions", () => {
  it("keeps filters and New session in the dashboard header action group", async () => {
    const dashboard = createDashboard();
    document.body.append(dashboard);
    await dashboard.updateComplete;

    const header = required(dashboard, ".dashboard-header");
    const actions = required(dashboard, ".dashboard-actions");

    expect(header.contains(actions)).toBe(true);
    expect(actions.querySelector('[role="group"][aria-label="Session filter"]')).not.toBeNull();
    expect(actions.querySelector(".new-session")?.textContent).toContain("New session");
  });

  it("keeps primary metadata visible and moves secondary details and Rename behind Actions", async () => {
    const dashboard = createDashboard();
    const onRenameSession = vi.fn();
    dashboard.onRenameSession = onRenameSession;
    document.body.append(dashboard);
    await dashboard.updateComplete;

    const card = required(dashboard, ".card");
    expect(card.querySelector(".primary-meta")?.textContent).toContain("Project");
    expect(card.querySelector(".primary-meta")?.textContent).toContain("Workspace");
    expect(card.querySelector(".primary-meta")?.textContent).toContain("Updated");
    expect(card.querySelector(".primary-meta")?.textContent).not.toContain("Machine");

    const details = required(dashboard, ".card-actions");
    const summary = required(dashboard, ".card-actions summary");
    if (!(details instanceof HTMLDetailsElement) || !(summary instanceof HTMLElement)) throw new Error("Expected accessible dashboard actions");
    const panel = required(dashboard, ".action-panel");
    expect(panel.textContent).toContain("Branch");
    expect(panel.textContent).toContain("Machine");
    expect(panel.textContent).toContain("Open session");
    expect(panel.textContent).toContain("Rename");

    details.open = true;
    const rename = required(dashboard, ".action-links button");
    if (!(rename instanceof HTMLButtonElement)) throw new Error("Expected Rename button");
    rename.click();

    expect(details.open).toBe(false);
    expect(onRenameSession).toHaveBeenCalledWith(expect.objectContaining({ id: "session" }), "local", summary);
    expect(summary.isConnected).toBe(true);
  });

  it("preserves a long activity line as accessible text while its compact surface truncates visually", async () => {
    const longActivity = "Review the dashboard layout and all of its responsive card behavior without letting this activity summary expand the card.";
    const longSession = session();
    longSession.firstMessage = longActivity;
    const dashboard = createDashboard([longSession]);
    document.body.append(dashboard);
    await dashboard.updateComplete;

    const activity = required(dashboard, ".activity");

    expect(activity.textContent).toBe(longActivity);
    expect(activity.getAttribute("title")).toBe(longActivity);
  });

  it("does not transfer an open action panel to another card when filtering", async () => {
    const dashboard = createDashboard();
    document.body.append(dashboard);
    await dashboard.updateComplete;

    const originalActions = required(dashboard, ".card-actions");
    if (!(originalActions instanceof HTMLDetailsElement)) throw new Error("Expected card actions");
    originalActions.open = true;
    const filters = dashboard.shadowRoot?.querySelectorAll<HTMLButtonElement>(".filters button");
    filters?.[1]?.click();
    await dashboard.updateComplete;

    const visibleCards = dashboard.shadowRoot?.querySelectorAll(".card");
    const visibleActions = required(dashboard, ".card-actions");
    if (!(visibleActions instanceof HTMLDetailsElement)) throw new Error("Expected filtered card actions");
    expect(visibleCards).toHaveLength(1);
    expect(visibleCards?.[0]?.textContent).toContain("Needs attention");
    expect(visibleActions.open).toBe(false);
  });
});

function createDashboard(sessions: LocalSessionDashboardSessionSummary[] = [session(), attentionSession()]): SessionDashboard {
  const dashboard = document.createElement("session-dashboard");
  if (!(dashboard instanceof SessionDashboard)) throw new Error("Expected session dashboard");
  dashboard.dashboard = {
    machines: [{
      machine: { id: "local", name: "Local", kind: "local", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      outcome: "available",
      capabilities: [PI_WEB_CAPABILITIES.sessionsRename],
      sessions,
    }],
  };
  dashboard.hrefForSession = () => "?session=session";
  return dashboard;
}

function required(dashboard: SessionDashboard, selector: string): Element {
  const element = dashboard.shadowRoot?.querySelector(selector);
  if (element === null || element === undefined) throw new Error(`Expected dashboard element: ${selector}`);
  return element;
}

function attentionSession(): LocalSessionDashboardSessionSummary {
  return {
    ...session(),
    id: "attention",
    name: "Needs attention",
    runtimeStatus: "active",
    displayStatus: "waiting",
    needsAttention: true,
  };
}

function session(): LocalSessionDashboardSessionSummary {
  return {
    id: "session",
    cwd: "/repo",
    name: "Modernist dashboard",
    firstMessage: "Match the handoff",
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:01:00.000Z",
    messageCount: 2,
    runtimeStatus: "idle",
    displayStatus: "idle",
    needsAttention: false,
    project: { id: "project", name: "PI WEB" },
    workspace: { id: "workspace", label: "main", branch: "issue-30", isMain: false },
  };
}
