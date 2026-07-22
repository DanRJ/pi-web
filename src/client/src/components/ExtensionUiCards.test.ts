import type { TemplateResult } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { ExtensionUiResponse } from "../api";
import { ExtensionUiCards } from "./ExtensionUiCards";

describe("ExtensionUiCards", () => {
  it("renders an accessible confirmation card and submits its typed response once", () => {
    const cards = new ExtensionUiCards();
    const onRespond = vi.fn();
    cards.requests = [{ id: "confirm-1", state: "pending", method: "confirm", title: "Delete session", message: "This cannot be undone." }];
    cards.onRespond = onRespond;

    const rendered = cards.render();
    expect(templateMarkup(rendered)).toContain("aria-label=");
    expect(templateValuesDeep(rendered)).toContain("Delete session");
    expect(templateMarkup(rendered)).toContain(">Confirm</button>");
    expect(templateMarkup(rendered)).toContain('class="choices extension-actions primary-actions"');
    expect(templateMarkup(rendered)).toContain(">Cancel</button>");

    // This node-environment test targets stable button wiring; a DOM harness
    // would add disproportionate setup for this narrow component boundary.
    const confirm = templateEventHandler(rendered, ">Confirm</button>");
    confirm(new Event("click"));
    confirm(new Event("click"));

    expect(onRespond).toHaveBeenCalledOnce();
    expect(onRespond).toHaveBeenCalledWith({ id: "confirm-1", confirmed: true } satisfies ExtensionUiResponse);
  });

  it("renders select options as full-width rows inside a constrained card", () => {
    const cards = new ExtensionUiCards();
    cards.requests = [{ id: "select-1", state: "pending", method: "select", title: "Choose", options: ["First", "A much longer second option that may wrap"] }];

    const rendered = cards.render();
    const styles = ExtensionUiCards.styles.cssText;
    expect(templateMarkup(rendered)).toContain('class="extension-card select-card"');
    expect(templateMarkup(rendered)).toContain('class="select-options"');
    expect(templateMarkup(rendered)).toContain('class="select-footer"');
    expect(styles).toContain(".select-card { box-sizing: border-box; width: 100%; max-width: 50rem;");
    expect(styles).toContain("border: 1px solid color-mix(in srgb, var(--pi-accent) 55%, var(--pi-border)); background: transparent;");
    expect(styles).toContain(".select-title { padding: var(--pi-space-4, 1rem); border-bottom: 1px solid color-mix(in srgb, var(--pi-accent) 55%, var(--pi-border));");
    expect(styles).toContain(".select-options { display: grid;");
    expect(styles).toContain(".select-options button { box-sizing: border-box; width: 100%; min-height: 3rem;");
    expect(styles).toContain("border: 1px solid var(--pi-border); background: var(--pi-surface);");
    expect(styles).toContain(".select-footer button.quiet { min-height: 2.5rem;");
    expect(styles).toContain("border: 1px solid transparent; border-radius: 0;");
    expect(styles).toContain(".select-footer button.quiet:not(:disabled):hover, .select-footer button.quiet:focus-visible { border-color: color-mix(in srgb, var(--pi-accent) 55%, var(--pi-border)); background: var(--pi-selection-bg);");
    expect(styles).toContain(".select-options button:not(:disabled):hover, .select-options button:focus-visible { border-color: var(--pi-accent); background: var(--pi-selection-bg);");
    expect(templateValuesDeep(rendered)).toEqual(expect.arrayContaining(["First", "A much longer second option that may wrap"]));
  });

  it("sends cancellation for a pending dialog", () => {
    const cards = new ExtensionUiCards();
    const onRespond = vi.fn();
    cards.requests = [{ id: "input-1", state: "pending", method: "input", title: "Name" }];
    cards.onRespond = onRespond;

    templateEventHandler(cards.render(), ">Cancel</button>")(new Event("click"));

    expect(onRespond).toHaveBeenCalledWith({ id: "input-1", cancelled: true } satisfies ExtensionUiResponse);
  });

  it("keeps visible focus treatment and coarse-pointer targets without changing reconciliation", () => {
    expect(ExtensionUiCards.styles.cssText).toContain("button:focus-visible, textarea:focus-visible");
    expect(ExtensionUiCards.styles.cssText).toContain("button { min-height: 2.75rem; }");
  });

  it("re-enables after a retryable submission failure and removes stale cards", async () => {
    const cards = new ExtensionUiCards();
    const onRespond = vi.fn()
      .mockResolvedValueOnce("retry")
      .mockResolvedValueOnce("removed");
    cards.requests = [{ id: "input-1", state: "pending", method: "input", title: "Name" }];
    cards.onRespond = onRespond;

    await templateEventHandler(cards.render(), ">Cancel</button>")(new Event("click"));
    await templateEventHandler(cards.render(), ">Cancel</button>")(new Event("click"));

    expect(onRespond).toHaveBeenCalledTimes(2);
    expect(templateValuesDeep(cards.render())).not.toContain("Name");
  });
});

function templateEventHandler(template: TemplateResult, marker: string): (event: Event) => unknown {
  const handler = findHandler(template, marker);
  if (handler === undefined) throw new Error(`Expected handler near ${marker}`);
  return handler;
}

function findHandler(value: unknown, marker: string): ((event: Event) => unknown) | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const handler = findHandler(item, marker);
      if (handler !== undefined) return handler;
    }
    return undefined;
  }
  if (!isTemplateResult(value)) return undefined;
  const strings = templateStrings(value);
  const values = templateValues(value);
  for (let index = 0; index < values.length; index += 1) {
    const candidate = values[index];
    if ((strings[index] ?? "").includes(marker) || (strings[index + 1] ?? "").includes(marker)) {
      if (isEventHandler(candidate)) return candidate;
    }
    const handler = findHandler(candidate, marker);
    if (handler !== undefined) return handler;
  }
  return undefined;
}

function isEventHandler(value: unknown): value is (event: Event) => unknown {
  return typeof value === "function";
}

function templateMarkup(template: TemplateResult): string {
  const chunks: string[] = [];
  visit(template);
  return chunks.join("");

  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!isTemplateResult(value)) return;
    chunks.push(...templateStrings(value));
    for (const child of templateValues(value)) visit(child);
  }
}

function templateValues(template: TemplateResult): unknown[] {
  const values = Reflect.get(template, "values");
  return Array.isArray(values) ? values : [];
}

function templateValuesDeep(template: TemplateResult): unknown[] {
  const values: unknown[] = [];
  visit(template);
  return values;

  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!isTemplateResult(value)) {
      values.push(value);
      return;
    }
    for (const child of templateValues(value)) visit(child);
  }
}

function templateStrings(template: TemplateResult): readonly string[] {
  const strings = Reflect.get(template, "strings");
  return Array.isArray(strings) ? strings : [];
}

function isTemplateResult(value: unknown): value is TemplateResult {
  return typeof value === "object" && value !== null && Array.isArray(Reflect.get(value, "strings")) && Array.isArray(Reflect.get(value, "values"));
}
