import type { TemplateResult } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { SessionStatus } from "../api";
import { PromptEditor } from "./PromptEditor";
import { promptEditorStyles } from "./shared";

describe("PromptEditor Modernist controls", () => {
  it("keeps scoped Modernist and legacy templates with their respective action orders", () => {
    const editor = new PromptEditor();
    editor.canSteer = true;
    editor.canStop = true;
    editor.status = status();

    const markup = templateMarkup(editor.render());
    expect(markup.indexOf('class="composer-template legacy-composer actions legacy-actions"')).toBeLessThan(markup.indexOf('class="composer-template modernist-composer actions modernist-actions"'));
    expect(markup.indexOf('class="action-context"')).toBeLessThan(markup.indexOf('class="action-execution"'));
    // The jsdom companion test covers rendered visibility, nested button order,
    // and callbacks; this node test keeps the fast template contract.
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

  it("gives Modernist one nonwrapping 44px row, with an explicit extra-narrow fallback", () => {
    // This structural contract protects CodeMirror from being remounted or
    // squeezed by a long model name while the keyboard viewport is reduced.
    expect(promptEditorStyles.cssText).toContain(".modernist-composer { display: none; }");
    expect(promptEditorStyles.cssText).toContain(".legacy-composer { display: none; }");
    expect(promptEditorStyles.cssText).toContain(".modernist-actions { grid-template-columns: minmax(0, 1fr) max-content; gap: 0.5rem; align-items: center; overflow: hidden; }");
    expect(promptEditorStyles.cssText).toContain(".action-context { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 0.5rem; min-width: 0; }");
    expect(promptEditorStyles.cssText).toContain("@container (max-width: 38rem)");
    expect(promptEditorStyles.cssText).toContain(".action-button { width: 2.75rem; height: 2.75rem; min-width: 2.75rem; padding: 0; }");
    expect(promptEditorStyles.cssText).toContain("@container (max-width: 22rem)");
    expect(promptEditorStyles.cssText).toContain(".actions { grid-template-columns: minmax(0, 1fr); }");
    expect(promptEditorStyles.cssText).toContain(".markdown-editor .cm-content { min-height: 38px; padding: 8px 44px 8px 8px;");
  });
});

describe("PromptEditor.send", () => {
  it("sends the current draft through the normal follow-up path", () => {
    const editor = new PromptEditor();
    const onSend = vi.fn();
    editor.onSend = onSend;
    editor.canSteer = true;
    setDraft(editor, "  explain this  ");

    editor.send();

    expect(onSend).toHaveBeenCalledWith("explain this", "followUp", undefined, undefined);
    expect(readDraft(editor)).toBe("");
  });

  it.each([
    { disabled: true, sending: false, draft: "hello" },
    { disabled: false, sending: true, draft: "hello" },
    { disabled: false, sending: false, draft: "   " },
  ])("does not send an unavailable or empty prompt", ({ disabled, sending, draft }) => {
    const editor = new PromptEditor();
    const onSend = vi.fn();
    editor.onSend = onSend;
    editor.disabled = disabled;
    editor.sending = sending;
    setDraft(editor, draft);

    editor.send();

    expect(onSend).not.toHaveBeenCalled();
    expect(readDraft(editor)).toBe(draft);
  });
});

function setDraft(editor: PromptEditor, draft: string): void {
  if (!Reflect.set(editor, "draft", draft)) throw new Error("Could not set prompt draft");
}

function readDraft(editor: PromptEditor): string {
  const draft: unknown = Reflect.get(editor, "draft");
  if (typeof draft !== "string") throw new Error("Prompt draft was unavailable");
  return draft;
}

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
