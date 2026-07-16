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
    expect(templateMarkup(rendered)).toContain(">Cancel</button>");

    // This node-environment test targets stable button wiring; a DOM harness
    // would add disproportionate setup for this narrow component boundary.
    const confirm = templateEventHandler(rendered, ">Confirm</button>");
    confirm(new Event("click"));
    confirm(new Event("click"));

    expect(onRespond).toHaveBeenCalledOnce();
    expect(onRespond).toHaveBeenCalledWith({ id: "confirm-1", confirmed: true } satisfies ExtensionUiResponse);
  });

  it("sends cancellation for a pending dialog", () => {
    const cards = new ExtensionUiCards();
    const onRespond = vi.fn();
    cards.requests = [{ id: "input-1", state: "pending", method: "input", title: "Name" }];
    cards.onRespond = onRespond;

    templateEventHandler(cards.render(), ">Cancel</button>")(new Event("click"));

    expect(onRespond).toHaveBeenCalledWith({ id: "input-1", cancelled: true } satisfies ExtensionUiResponse);
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
