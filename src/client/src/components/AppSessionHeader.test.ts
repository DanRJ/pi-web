import type { TemplateResult } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { SessionInfo, SessionStatus } from "../api";
import { AppSessionHeader, sessionShellStatus } from "./AppSessionHeader";

describe("sessionShellStatus", () => {
  it("provides text and an icon state for every status, not color alone", () => {
    expect(sessionShellStatus(status({ isStreaming: true }), undefined)).toMatchObject({ kind: "running", label: "Running" });
    expect(sessionShellStatus(status({ pendingMessageCount: 2 }), undefined)).toMatchObject({ kind: "queued", label: "Queued", detail: "2 messages queued" });
    for (const activeStatus of [{ isStreaming: true }, { isBashRunning: true }, { isCompacting: true }]) {
      expect(sessionShellStatus(status({ ...activeStatus, pendingMessageCount: 2 }), undefined)).toMatchObject({ kind: "running", label: "Running", detail: "Session is active; 2 messages queued" });
    }
    expect(sessionShellStatus(status(), { sessionId: "session-1", phase: "error", label: "Command failed", at: "2026-07-14T00:00:00.000Z" })).toMatchObject({ kind: "error", label: "Error", detail: "Command failed" });
    expect(sessionShellStatus(status(), undefined)).toMatchObject({ kind: "idle", label: "Idle" });
  });
});

describe("AppSessionHeader", () => {
  it("renders an accessible theme control and calls its callback", () => {
    const header = new AppSessionHeader();
    const onToggleTheme = vi.fn();
    header.session = session();
    header.onToggleTheme = onToggleTheme;

    const template = header.render();
    expect(templateStrings(template).join("")).toContain('aria-label="Toggle light and dark theme"');

    // Template extraction is proportionate here: this narrow test verifies the
    // Lit callback binding without introducing a browser custom-element harness.
    const callback = callbackAfterMarker(template, 'aria-label="Toggle light and dark theme"');
    callback();
    expect(onToggleTheme).toHaveBeenCalledOnce();
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

  it("keeps Stop beside title, status, and theme controls in the compact header", () => {
    const header = new AppSessionHeader();
    header.session = session();
    header.canStop = true;

    expect(templateMarkup(header.render())).toContain('class="session-stop-control"');
    expect(AppSessionHeader.styles.cssText).toContain(".session-detail, .session-stop-control { display: none; }");
    expect(AppSessionHeader.styles.cssText).toContain("button { min-width: 2.75rem; min-height: 2.75rem; }");
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

function callbackAfterMarker(template: TemplateResult | null, marker: string): () => void {
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

function isVoidCallback(value: unknown): value is () => void {
  return typeof value === "function";
}
