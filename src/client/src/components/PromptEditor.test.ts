import type { TemplateResult } from "lit";
import { describe, expect, it } from "vitest";
import type { SessionStatus } from "../api";
import { PromptEditor } from "./PromptEditor";
import { promptEditorStyles } from "./shared";

describe("PromptEditor Calm Cockpit controls", () => {
  it("keeps attachment, delivery, send, steer, and Stop controls accessible", () => {
    const editor = new PromptEditor();
    editor.canSteer = true;
    editor.canStop = true;
    editor.status = status();

    const markup = templateMarkup(editor.render());
    expect(markup).toContain('aria-label="Attach files"');
    expect(markup).toContain('aria-label="Steer current response"');
    expect(valuesDeep(editor.render())).toEqual(expect.arrayContaining([
      "Queue message",
      "Thinking level: medium",
      "Stop current work",
    ]));
  });

  it("only promises queue clearing when the server count confirms it", () => {
    const editor = new PromptEditor();
    editor.canStop = true;

    expect(valuesDeep(editor.render())).toEqual(expect.arrayContaining(["Stop current work"]));
    expect(valuesDeep(editor.render())).not.toContain("Stop current work and clear queued server messages");

    editor.clearsServerQueue = true;
    expect(valuesDeep(editor.render())).toEqual(expect.arrayContaining(["Stop current work and clear queued server messages"]));
  });

  it("does not re-render the CodeMirror shell for token-only status churn", () => {
    const editor = new PromptEditor();
    editor.status = status();
    const candidate: unknown = Reflect.get(editor, "shouldUpdate");
    if (!isShouldUpdate(candidate)) throw new Error("Expected PromptEditor shouldUpdate");

    expect(candidate.call(editor, new Map([["status", status({ tokens: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, total: 5 } })]]))).toBe(false);
    expect(candidate.call(editor, new Map([["status", status({ thinkingLevel: "high" })]]))).toBe(true);
  });

  it("uses a yielding model slot and fixed coarse-pointer action targets on mobile", () => {
    // The structural sizing contract is intentionally tested here because it
    // protects CodeMirror from being remounted or squeezed by long model names.
    expect(promptEditorStyles.cssText).toContain(':host-context(:root[data-pi-web-theme^="themes:modernist-"]) .actions');
    expect(promptEditorStyles.cssText).toContain("grid-template-columns: minmax(0, 1fr) repeat(3, max-content)");
    expect(promptEditorStyles.cssText).toContain(".icon-button, .editor-attach { width: 2.75rem; height: 2.75rem; min-width: 2.75rem; min-height: 2.75rem; }");
  });
});

function status(overrides: Partial<SessionStatus> = {}): SessionStatus {
  return {
    sessionId: "session-1",
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 },
    cost: 0,
    model: { provider: "provider", id: "model" },
    thinkingLevel: "medium",
    ...overrides,
  };
}

function templateMarkup(template: TemplateResult): string {
  return `${strings(template).join("")}${values(template).map((value) => isTemplate(value) ? templateMarkup(value) : Array.isArray(value) ? value.filter(isTemplate).map(templateMarkup).join("") : "").join("")}`;
}

function valuesDeep(template: TemplateResult): unknown[] {
  const result: unknown[] = [];
  visit(template);
  return result;

  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isTemplate(value)) {
      result.push(value);
      return;
    }
    values(value).forEach(visit);
  }
}

function strings(template: TemplateResult): readonly string[] {
  const value = Reflect.get(template, "strings");
  return Array.isArray(value) ? value : [];
}

function values(template: TemplateResult): unknown[] {
  const value = Reflect.get(template, "values");
  return Array.isArray(value) ? value : [];
}

function isShouldUpdate(value: unknown): value is (this: PromptEditor, changed: Map<string, unknown>) => boolean {
  return typeof value === "function";
}

function isTemplate(value: unknown): value is TemplateResult {
  return typeof value === "object" && value !== null && Array.isArray(Reflect.get(value, "strings"));
}
