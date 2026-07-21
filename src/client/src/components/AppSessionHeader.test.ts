import type { TemplateResult } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { SessionInfo, SessionStatus } from "../api";
import { AppSessionHeader, sessionStateLabel, sessionStatusPresentation } from "./AppSessionHeader";

describe("sessionStatusPresentation", () => {
  it("uses the truthful precedence order and never invents a detail", () => {
    const runningTool = { sessionId: "session-1", phase: "active" as const, label: "running tool", detail: "read", at: "2026-07-14T00:00:00.000Z" };
    const error = { sessionId: "session-1", phase: "error" as const, label: "Command failed", at: "2026-07-14T00:00:00.000Z" };

    expect(sessionStatusPresentation({ status: status({ isCompacting: true, isBashRunning: true, isStreaming: true }), activity: runningTool, waitingForUser: true, isSendingPrompt: true })).toMatchObject({ kind: "waiting", label: "Waiting", shortLabel: "Wait" });
    expect(sessionStatusPresentation({ status: status({ isCompacting: true, isBashRunning: true }), activity: runningTool })).toMatchObject({ kind: "compacting", label: "Compacting" });
    expect(sessionStatusPresentation({ status: status({ isBashRunning: true, isStreaming: true }), activity: runningTool })).toMatchObject({ kind: "shell", label: "Shell", detail: "read" });
    expect(sessionStatusPresentation({ status: status({ isStreaming: true }), activity: runningTool })).toMatchObject({ kind: "tool", label: "Tool running", detail: "read" });
    expect(sessionStatusPresentation({ status: status({ pendingMessageCount: 2 }), isSendingPrompt: true })).toMatchObject({ kind: "working", label: "Working" });
    expect(sessionStatusPresentation({ status: status({ isStreaming: true }), activity: error })).toMatchObject({ kind: "working", label: "Working" });
    expect(sessionStatusPresentation({ status: status(), activity: error })).toMatchObject({ kind: "error", label: "Error", detail: "Command failed" });
    expect(sessionStatusPresentation({ status: status() })).toEqual({ kind: "idle", label: "Idle", shortLabel: "Idle" });
  });
});

describe("AppSessionHeader", () => {
  it("does not duplicate the global theme control in the session header", () => {
    const header = new AppSessionHeader();
    header.session = session();

    const markup = templateMarkup(header.render());
    expect(markup).not.toContain("theme-control");
    expect(markup).not.toContain("Toggle light and dark theme");
  });

  it("only renders an accessible Stop control when stopping active work is supported", () => {
    const header = new AppSessionHeader();
    const onStop = vi.fn();
    header.session = session();
    header.onStop = onStop;
    header.canStop = false;
    expect(templateContainsText(header.render(), 'class="session-stop-control"')).toBe(false);

    header.canStop = true;
    const template = header.render();
    expect(templateContainsText(template, 'class="session-stop-control"')).toBe(true);
    expect(templateMarkup(template)).toContain('aria-label="Stop session work"');
    callbackAfterMarker(template, 'class="session-stop-control"')();
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("only announces queue clearing when Stop is enabled and it clears the server queue", () => {
    const header = new AppSessionHeader();
    header.session = session();
    header.clearsServerQueue = true;
    expect(templateMarkup(header.render())).not.toContain("clear queued server messages");

    header.canStop = true;
    expect(templateMarkup(header.render())).toContain('aria-label="Stop session work and clear queued server messages"');

    header.clearsServerQueue = false;
    expect(templateMarkup(header.render())).not.toContain("clear queued server messages");
  });

  it("keeps a textual compact status and Stop beside the session title", () => {
    const header = new AppSessionHeader();
    header.session = session();
    header.canStop = true;

    expect(templateMarkup(header.render())).toContain('class="session-stop-control"');
    expect(templateMarkup(header.render())).toContain('role="status"');
    expect(valuesDeep(header.render())).toContain("idle");
    expect(AppSessionHeader.styles.cssText).toContain(".session-detail, .session-stop-control { display: none; }");
    expect(AppSessionHeader.styles.cssText).toContain("button { min-width: 2.75rem; min-height: 2.75rem; height: 2.75rem; }");
  });

  it("reduces runtime activity to the running, waiting, and idle badge labels", () => {
    expect(sessionStateLabel("working")).toBe("running");
    expect(sessionStateLabel("shell")).toBe("running");
    expect(sessionStateLabel("tool")).toBe("running");
    expect(sessionStateLabel("compacting")).toBe("running");
    expect(sessionStateLabel("waiting")).toBe("waiting");
    expect(sessionStateLabel("idle")).toBe("idle");
    expect(sessionStateLabel("error")).toBe("idle");
  });

  it("omits Rename when the effective runtime lacks the capability", () => {
    const header = new AppSessionHeader();
    header.session = session();

    const markup = templateMarkup(header.render());
    expect(markup).not.toContain("rename-control");
    expect(markup).not.toContain("Rename unavailable");
  });

  it("enables Rename for an unarchived session and explains restore-first for archived sessions", () => {
    const header = new AppSessionHeader();
    const onRename = vi.fn();
    header.session = session();
    header.canRename = true;
    header.onRename = onRename;

    class TestHTMLElement { readonly testElement = true; }
    vi.stubGlobal("HTMLElement", TestHTMLElement);
    const rename = callbackAfterMarker(header.render(), 'class="rename-control"');
    rename({ currentTarget: new HTMLElement() });
    vi.unstubAllGlobals();
    expect(onRename).toHaveBeenCalledOnce();

    header.session = { ...session(), archived: true };
    const archived = templateMarkup(header.render());
    expect(archived).toContain('class="rename-control"');
    expect(archived).toContain("Restore this session before renaming.");
    expect(archived).toContain("disabled");
  });

  it("does not duplicate navigation, Actions, or settings controls", () => {
    const header = new AppSessionHeader();
    header.session = session();

    const markup = templateMarkup(header.render());
    expect(markup).not.toContain("Show actions");
    expect(markup).not.toContain("Open settings");
    expect(markup).not.toContain("Select machine");
  });
});

function session(): SessionInfo {
  return {
    id: "session-1",
    cwd: "/repo",
    path: "/repo/session-1.jsonl",
    created: "2026-07-14T00:00:00.000Z",
    modified: "2026-07-14T00:00:00.000Z",
    messageCount: 1,
    firstMessage: "Modernize the shell",
  };
}

function status(overrides: Partial<SessionStatus> = {}): SessionStatus {
  return {
    sessionId: "session-1",
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

function callbackAfterMarker(template: TemplateResult | null, marker: string): (event?: unknown) => void {
  const markedTemplate = templateWithMarker(template, marker);
  if (markedTemplate === undefined) throw new Error(`Expected template containing ${marker}`);
  const strings = templateStrings(markedTemplate);
  const values = templateValues(markedTemplate);
  const index = strings.findIndex((part) => part.includes(marker));
  const callback = values[index];
  if (!isVoidCallback(callback)) throw new Error(`Expected callback after ${marker}`);
  return callback;
}

function templateStrings(template: TemplateResult | null): readonly string[] {
  if (template === null) return [];
  const strings = Reflect.get(template, "strings");
  if (!Array.isArray(strings) || !strings.every((part: unknown) => typeof part === "string")) throw new Error("Template strings were unavailable");
  return strings;
}

function templateValues(template: TemplateResult): readonly unknown[] {
  const values = Reflect.get(template, "values");
  if (!Array.isArray(values)) throw new Error("Template values were unavailable");
  return values;
}

function templateContainsText(template: TemplateResult | null, text: string): boolean {
  return templateWithMarker(template, text) !== undefined;
}

function templateMarkup(template: TemplateResult | null): string {
  if (template === null) return "";
  return `${templateStrings(template).join("")}${templateValues(template).map((value) => nestedTemplateMarkup(value)).join("")}`;
}

function nestedTemplateMarkup(value: unknown): string {
  if (isTemplateResult(value)) return templateMarkup(value);
  if (Array.isArray(value)) return value.map((item) => nestedTemplateMarkup(item)).join("");
  return "";
}

function valuesDeep(template: TemplateResult | null): unknown[] {
  if (template === null) return [];
  const result: unknown[] = [];
  visit(template);
  return result;

  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isTemplateResult(value)) {
      result.push(value);
      return;
    }
    templateValues(value).forEach(visit);
  }
}

function templateWithMarker(template: TemplateResult | null, marker: string): TemplateResult | undefined {
  if (template === null) return undefined;
  if (templateStrings(template).join("").includes(marker)) return template;
  for (const value of templateValues(template)) {
    if (isTemplateResult(value)) {
      const nested = templateWithMarker(value, marker);
      if (nested !== undefined) return nested;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (!isTemplateResult(item)) continue;
        const nested = templateWithMarker(item, marker);
        if (nested !== undefined) return nested;
      }
    }
  }
  return undefined;
}

function isTemplateResult(value: unknown): value is TemplateResult {
  return typeof value === "object" && value !== null && Array.isArray(Reflect.get(value, "strings"));
}

function isVoidCallback(value: unknown): value is (event?: unknown) => void {
  return typeof value === "function";
}
