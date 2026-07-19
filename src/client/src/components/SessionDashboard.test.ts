import type { TemplateResult } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { LocalSessionDashboardSessionSummary } from "../api";
import { relativeTime, SessionDashboard } from "./SessionDashboard";

describe("SessionDashboard presentation helpers", () => {
  it("uses a truthful fallback for invalid relative timestamps", () => {
    expect(relativeTime("not-a-date", Date.now())).toBe("Unknown time");
  });

  it("formats local relative time without depending on server labels", () => {
    expect(relativeTime("2026-01-01T00:01:00.000Z", Date.parse("2026-01-01T00:00:00.000Z"))).toContain("minute");
  });

  it("keeps title and Open session as native links without an explicit new-tab option", () => {
    const dashboard = new SessionDashboard();
    dashboard.hrefForSession = () => "/sessions/s1";
    const card = renderCard(dashboard);

    expect(strings(card).join("")).not.toContain("Open in new tab");
    expect(strings(card).join("")).not.toContain('target="_blank"');
    expect(values(card).filter((value) => value === "/sessions/s1")).toHaveLength(2);
  });

  it("gates Rename by each local or remote machine capability and calls the enabled callback", () => {
    const dashboard = new SessionDashboard();
    const onRenameSession = vi.fn();
    dashboard.onRenameSession = onRenameSession;

    const available = renderCard(dashboard, true);
    const availableValues = valuesDeep(available);
    const renameTitleIndex = availableValues.findIndex((value) => value === "Rename session");
    const rename = availableValues[renameTitleIndex + 2];
    if (!isRenameCallback(rename)) throw new Error("Rename callback unavailable");
    class TestHTMLElement { readonly testElement = true; }
    vi.stubGlobal("HTMLElement", TestHTMLElement);
    rename({ currentTarget: new HTMLElement() });
    expect(onRenameSession).toHaveBeenCalledWith(session(), "local", expect.anything());
    vi.unstubAllGlobals();

    const unavailable = renderCard(dashboard, false);
    expect(templateMarkup(unavailable)).toContain("Update and restart Pi-Web on this machine to rename sessions.");
  });

  it("does not intercept Ctrl or middle clicks on Open session", () => {
    const dashboard = new SessionDashboard();
    const onOpenSession = vi.fn();
    dashboard.onOpenSession = onOpenSession;
    const handler = openSessionHandler(renderCard(dashboard));
    const ctrlClick = clickEvent({ ctrlKey: true });
    const middleClick = clickEvent({ button: 1 });

    // Template extraction is proportionate here: this narrow test verifies the
    // rendered Open session link's click wiring without requiring a DOM harness.
    handler(ctrlClick.event);
    handler(middleClick.event);

    expect(ctrlClick.preventDefault).not.toHaveBeenCalled();
    expect(middleClick.preventDefault).not.toHaveBeenCalled();
    expect(onOpenSession).not.toHaveBeenCalled();
  });
});

interface SessionLinkClickEvent {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  preventDefault(): void;
}

function renderCard(dashboard: SessionDashboard, canRename = false): TemplateResult {
  const method: unknown = Reflect.get(dashboard, "renderCard");
  if (!isUnknownMethod(method)) throw new Error("Card renderer unavailable");
  const card = method.call(dashboard, session(), "local", "Local", canRename);
  if (!isTemplate(card)) throw new Error("Card template unavailable");
  return card;
}

function openSessionHandler(card: TemplateResult): (event: SessionLinkClickEvent) => void {
  const markerIndex = strings(card).findIndex((value) => value.includes(">Open session</a>"));
  const handler = markerIndex > 0 ? values(card)[markerIndex - 1] : undefined;
  if (!isSessionLinkClickHandler(handler)) throw new Error("Open session handler unavailable");
  return handler;
}

function clickEvent(overrides: Partial<Omit<SessionLinkClickEvent, "preventDefault">>) {
  const preventDefault = vi.fn();
  return {
    preventDefault,
    event: { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, preventDefault, ...overrides },
  };
}

function session(): LocalSessionDashboardSessionSummary {
  return {
    id: "s1",
    cwd: "/repo",
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:00.000Z",
    messageCount: 1,
    firstMessage: "Open session",
    runtimeStatus: "idle",
    displayStatus: "idle",
    needsAttention: false,
    project: { id: "p1", name: "Project" },
    workspace: { id: "w1", label: "main", isMain: true },
  };
}

function templateMarkup(template: TemplateResult): string {
  return `${strings(template).join("")}${values(template).map((value) => Array.isArray(value) ? value.map((item) => isTemplate(item) ? templateMarkup(item) : "").join("") : isTemplate(value) ? templateMarkup(value) : "").join("")}`;
}

function valuesDeep(template: TemplateResult): unknown[] {
  const result: unknown[] = [];
  const visit = (value: unknown): void => {
    if (isTemplate(value)) {
      for (const nested of values(value)) visit(nested);
      return;
    }
    if (Array.isArray(value)) {
      for (const nested of value) visit(nested);
      return;
    }
    result.push(value);
  };
  for (const value of values(template)) visit(value);
  return result;
}

function strings(template: TemplateResult): readonly string[] {
  const value: unknown = Reflect.get(template, "strings");
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error("Template strings unavailable");
  return value;
}

function values(template: TemplateResult): readonly unknown[] {
  const value: unknown = Reflect.get(template, "values");
  if (!Array.isArray(value)) throw new Error("Template values unavailable");
  return value;
}

function isRenameCallback(value: unknown): value is (event: unknown) => void {
  return typeof value === "function";
}

function isTemplate(value: unknown): value is TemplateResult {  return typeof value === "object" && value !== null && Array.isArray(Reflect.get(value, "strings"));
}

function isUnknownMethod(value: unknown): value is { call(thisArg: unknown, ...args: unknown[]): unknown } {
  return typeof value === "function";
}

function isSessionLinkClickHandler(value: unknown): value is (event: SessionLinkClickEvent) => void {
  return typeof value === "function";
}
