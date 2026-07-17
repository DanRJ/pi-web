import type { TemplateResult } from "lit";
import { describe, expect, it, vi } from "vitest";
import { AppMobileDestinationTabs, nextDestination } from "./AppMobileDestinationTabs";

describe("AppMobileDestinationTabs", () => {
  it("renders the exact labelled destination order as mobile navigation buttons", () => {
    const tabs = new AppMobileDestinationTabs();
    tabs.selected = "chat";
    tabs.toolsAvailable = true;

    const template = tabs.render();
    const markup = templateMarkup(template);
    expect(markup).toContain('<nav aria-label="Mobile destinations">');
    expect(markup).not.toContain('role="tablist"');
    expect(tabDestinations(template)).toEqual(["chat", "sessions", "tools", "settings"]);
    expect(tabTemplates(template).some((tab) => templateStrings(tab).some((part) => part.includes("aria-current=")))).toBe(true);
    expect(templateMarkup(tabTemplates(template).find((tab) => templateValues(tab)[0] === "settings") ?? template)).toContain("aria-haspopup=");
  });

  it("skips unavailable Tools when navigating with a keyboard", () => {
    expect(nextDestination("sessions", 1, false)).toBe("settings");
    expect(nextDestination("settings", 1, false)).toBe("chat");
  });

  it("selects Settings through its real callback", () => {
    const tabs = new AppMobileDestinationTabs();
    const onSelect = vi.fn();
    tabs.onSelect = onSelect;
    const template = tabs.render();
    const callback = callbackAfterDestination(template, "settings");
    callback();
    expect(onSelect).toHaveBeenCalledWith("settings");
  });
});

function callbackAfterDestination(template: TemplateResult, destination: string): () => void {
  const tab = tabTemplates(template).find((candidate) => templateValues(candidate)[0] === destination);
  if (tab === undefined) throw new Error(`Expected ${destination} tab`);
  const index = templateStrings(tab).findIndex((part) => part.includes("@click="));
  const callback = templateValues(tab)[index];
  if (!isVoidCallback(callback)) throw new Error(`Expected ${destination} callback`);
  return callback;
}

function tabDestinations(template: TemplateResult): string[] {
  return tabTemplates(template).map((tab) => templateValues(tab)[0]).filter((destination): destination is string => typeof destination === "string");
}

function tabTemplates(template: TemplateResult): TemplateResult[] {
  const nested = templateValues(template).flatMap((value) => templatesIn(value));
  return nested.filter((candidate) => templateStrings(candidate).some((part) => part.includes("data-destination=")));
}

function templatesIn(value: unknown): TemplateResult[] {
  if (Array.isArray(value)) return value.flatMap((item) => templatesIn(item));
  if (!isTemplate(value)) return [];
  return [value, ...templateValues(value).flatMap((item) => templatesIn(item))];
}

function templateMarkup(template: TemplateResult): string {
  return `${templateStrings(template).join("")}${templateValues(template).map((value) => nestedMarkup(value)).join("")}`;
}

function nestedMarkup(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => nestedMarkup(item)).join("");
  if (isTemplate(value)) return templateMarkup(value);
  return "";
}

function templateStrings(template: TemplateResult): readonly string[] {
  const strings: unknown = Reflect.get(template, "strings");
  if (!isStringArray(strings)) throw new Error("Template strings unavailable");
  return strings;
}

function templateValues(template: TemplateResult): readonly unknown[] {
  const values = Reflect.get(template, "values");
  if (!Array.isArray(values)) throw new Error("Template values unavailable");
  return values;
}

function isTemplate(value: unknown): value is TemplateResult {
  return typeof value === "object" && value !== null && Array.isArray(Reflect.get(value, "strings"));
}

function isVoidCallback(value: unknown): value is () => void {
  return typeof value === "function";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
