import type { TemplateResult } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { SessionInfo, SessionStatus } from "../api";
import { markCachedNewSessionInfo } from "../cachedNewSessions";
import { isArchivableSessionInfo, isTransientNewSessionInfo } from "../sessionPersistence";
import { SessionList, sessionRowActivityKind, sessionRowsForCurrentTree } from "./SessionList";

describe("sessionRowActivityKind", () => {
  const idle = sessionStatus("s");

  it("reports 'sending' for an uploading session, taking precedence over server activity", () => {
    expect(sessionRowActivityKind(session("s"), idle, undefined, true)).toBe("sending");
    expect(sessionRowActivityKind(session("s"), { ...idle, isStreaming: true }, undefined, true)).toBe("sending");
  });

  it("reports 'session' for server activity when not sending", () => {
    expect(sessionRowActivityKind(session("s"), { ...idle, isStreaming: true }, undefined, false)).toBe("session");
  });

  it("reports undefined when idle and not sending", () => {
    expect(sessionRowActivityKind(session("s"), idle, undefined, false)).toBeUndefined();
  });

  it("never shows an indicator for archived or cached-new sessions, even while sending", () => {
    expect(sessionRowActivityKind({ ...session("s"), archived: true }, idle, undefined, true)).toBeUndefined();
    expect(sessionRowActivityKind(markCachedNewSessionInfo(session("s")), idle, undefined, true)).toBeUndefined();
  });
});

describe("session action eligibility", () => {
  it("requires a persisted server signal before archiving when persistence is authoritative", () => {
    const authoritative = { authoritative: true };
    expect(isArchivableSessionInfo(session("persisted", { persisted: true }), undefined, authoritative)).toBe(true);
    expect(isArchivableSessionInfo(session("unknown"), undefined, authoritative)).toBe(false);
    expect(isArchivableSessionInfo(session("transient", { persisted: false }), undefined, authoritative)).toBe(false);
    expect(isArchivableSessionInfo({ ...session("archived", { persisted: true }), archived: true, archivedAt: "2026-06-09T00:00:00.000Z" }, undefined, authoritative)).toBe(false);
  });

  it("preserves legacy archiving when persistence support is not advertised", () => {
    expect(isArchivableSessionInfo(session("legacy"))).toBe(true);
    expect(isTransientNewSessionInfo(session("legacy"))).toBe(false);
  });

  it("allows deleting transient non-archived sessions from server or browser-cached signals", () => {
    expect(isTransientNewSessionInfo(session("transient", { persisted: false }))).toBe(true);
    expect(isTransientNewSessionInfo(markCachedNewSessionInfo(session("cached")))).toBe(true);
    expect(isTransientNewSessionInfo(session("persisted", { persisted: true }))).toBe(false);
    expect(isTransientNewSessionInfo({ ...session("archived", { persisted: false }), archived: true, archivedAt: "2026-06-09T00:00:00.000Z" })).toBe(false);
  });

  it("uses matching status as the freshest persistence signal", () => {
    const staleTransient = session("s", { persisted: false });
    expect(isArchivableSessionInfo(staleTransient, sessionStatus("s", { persisted: true }))).toBe(true);
    expect(isTransientNewSessionInfo(staleTransient, sessionStatus("s", { persisted: true }))).toBe(false);

    const stalePersisted = session("s", { persisted: true });
    expect(isArchivableSessionInfo(stalePersisted, sessionStatus("s", { persisted: false }))).toBe(false);
    expect(isTransientNewSessionInfo(stalePersisted, sessionStatus("s", { persisted: false }))).toBe(true);

    expect(isArchivableSessionInfo(staleTransient, sessionStatus("other", { persisted: true }))).toBe(false);
  });
});

describe("SessionList Rename menu", () => {
  it("enables rename for current sessions, disables archived sessions, and explains unsupported runtimes", () => {
    const list = new SessionList();
    const onRename = vi.fn();
    list.onRename = onRename;
    list.canRename = true;

    const enabled = renderSessionMenu(list, session("current"));
    const enabledValues = templateValuesDeep(enabled);
    const titleIndex = enabledValues.findIndex((value) => value === "Rename session");
    const rename = enabledValues[titleIndex + 2];
    if (!isRenameCallback(rename)) throw new Error("Rename callback unavailable");
    class TestHTMLElement { readonly testElement = true; }
    vi.stubGlobal("HTMLElement", TestHTMLElement);
    rename({ currentTarget: new HTMLElement() });
    expect(onRename).toHaveBeenCalledWith(session("current"), expect.anything());
    vi.unstubAllGlobals();

    expect(templateMarkup(renderSessionMenu(list, { ...session("archived"), archived: true }))).toContain("Restore this session before renaming.");

    list.canRename = false;
    expect(templateValuesDeep(renderSessionMenu(list, session("unsupported")))).toContain(list.renameUnavailableMessage);
  });
});

describe("sessionRowsForCurrentTree", () => {
  it("keeps archived ancestors visible while they have unarchived descendants", () => {
    const parent = { ...session("parent"), archived: true, archivedAt: "2026-06-09T00:00:00.000Z" };
    const child = session("child", { parentSessionPath: parent.path });

    expect(rowSummaries(sessionRowsForCurrentTree([parent, child]))).toEqual([
      { id: "parent", depth: 0, hasMissingParent: false },
      { id: "child", depth: 1, hasMissingParent: false },
    ]);
  });

  it("hides archived parents from the current tree once children are detached", () => {
    const parent = { ...session("parent"), archived: true, archivedAt: "2026-06-09T00:00:00.000Z" };
    const detachedChild = session("child");

    expect(rowSummaries(sessionRowsForCurrentTree([parent, detachedChild]))).toEqual([
      { id: "child", depth: 0, hasMissingParent: false },
    ]);
  });

  it("still marks unavailable parents when the parent record is missing", () => {
    const child = session("child", { parentSessionPath: "/sessions/missing.jsonl" });

    expect(rowSummaries(sessionRowsForCurrentTree([child]))).toEqual([
      { id: "child", depth: 0, hasMissingParent: true },
    ]);
  });
});

function renderSessionMenu(list: SessionList, value: SessionInfo): TemplateResult {
  Reflect.set(list, "openMenuSessionId", value.id);
  const renderer: unknown = Reflect.get(list, "renderSession");
  if (typeof renderer !== "function") throw new Error("Session row renderer unavailable");
  const rendered: unknown = renderer.call(list, { session: value, depth: 0, hasMissingParent: false }, 0, "current");
  if (!isTemplate(rendered)) throw new Error("Session row template unavailable");
  return rendered;
}

function templateMarkup(template: TemplateResult): string {
  return `${templateStrings(template).join("")}${templateValues(template).map((value) => Array.isArray(value) ? value.map((item) => isTemplate(item) ? templateMarkup(item) : "").join("") : isTemplate(value) ? templateMarkup(value) : "").join("")}`;
}

function templateValuesDeep(template: TemplateResult): unknown[] {
  const result: unknown[] = [];
  const visit = (value: unknown): void => {
    if (isTemplate(value)) {
      for (const nested of templateValues(value)) visit(nested);
      return;
    }
    if (Array.isArray(value)) {
      for (const nested of value) visit(nested);
      return;
    }
    result.push(value);
  };
  for (const value of templateValues(template)) visit(value);
  return result;
}

function templateStrings(template: TemplateResult): readonly string[] {
  const strings: unknown = Reflect.get(template, "strings");
  if (!Array.isArray(strings)) throw new Error("Template strings unavailable");
  return strings.every((item) => typeof item === "string") ? strings : [];
}

function templateValues(template: TemplateResult): readonly unknown[] {
  const values: unknown = Reflect.get(template, "values");
  if (!Array.isArray(values)) throw new Error("Template values unavailable");
  return values;
}

function isRenameCallback(value: unknown): value is (event: unknown) => void {
  return typeof value === "function";
}

function isTemplate(value: unknown): value is TemplateResult {  return typeof value === "object" && value !== null && Array.isArray(Reflect.get(value, "strings"));
}

function rowSummaries(rows: ReturnType<typeof sessionRowsForCurrentTree>) {
  return rows.map((row) => ({ id: row.session.id, depth: row.depth, hasMissingParent: row.hasMissingParent }));
}

function sessionStatus(sessionId: string, overrides: Partial<SessionStatus> = {}): SessionStatus {
  return {
    sessionId,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
    ...overrides,
  };
}

function session(id: string, overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id,
    path: `/sessions/${id}.jsonl`,
    cwd: "/workspace",
    created: "2026-06-09T00:00:00.000Z",
    modified: "2026-06-09T00:00:00.000Z",
    messageCount: 1,
    firstMessage: id,
    ...overrides,
  };
}
