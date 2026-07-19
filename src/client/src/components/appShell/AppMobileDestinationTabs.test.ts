import { nothing, type TemplateResult } from "lit";
import { describe, expect, it, vi } from "vitest";
import { AppMobileDestinationTabs, nextDestination } from "./AppMobileDestinationTabs";

describe("AppMobileDestinationTabs", () => {
  it("renders the exact labelled destination order as mobile navigation buttons", () => {
    const tabs = new AppMobileDestinationTabs();
    tabs.selected = "chat";

    const template = tabs.render();
    const markup = templateMarkup(template);
    expect(markup).toContain('<nav aria-label="Mobile destinations">');
    expect(markup).not.toContain('role="tablist"');
    expect(tabDestinations(template)).toEqual(["chat", "sessions", "tools", "settings"]);
    expect(templateMarkup(template)).not.toContain("?disabled=");
    expect(tabTemplates(template).some((tab) => templateStrings(tab).some((part) => part.includes("aria-current=")))).toBe(true);
    expect(settingsTabMarkup(template)).toContain("aria-haspopup=");
    expect(templateValues(settingsTab(template))).toContain("dialog");
  });

  it("keeps every mobile destination button horizontal, centered, and visible at narrow widths", () => {
    const styles = AppMobileDestinationTabs.styles.cssText;

    expect(styles).toContain(".destinations { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); width: 100%; max-width: 100%; min-width: 0;");
    expect(styles).toContain("button { box-sizing: border-box; display: flex; align-items: center; justify-content: center; gap: 0.25rem; width: 100%; max-width: 100%; min-width: 0; min-height: 2.75rem; overflow: hidden;");
    expect(styles).toContain("white-space: nowrap;");
    expect(styles).toContain("button span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }");
    expect(styles).toContain("button[aria-current=\"page\"] { box-shadow:");
    expect(styles).toContain("button:focus-visible { outline:");
    expect(styles).toContain("@media (max-width: 359px) { button { gap: 0.1875rem; font-size: 0.625rem; }");
  });

  it("omits dialog semantics when Modernist presents Settings as a destination", () => {
    const tabs = new AppMobileDestinationTabs();
    tabs.settingsPresentation = "destination";

    expect(settingsTabMarkup(tabs.render())).toContain("aria-haspopup=");
    expect(templateValues(settingsTab(tabs.render()))).toContain(nothing);
  });

  it.each(["dialog", "destination"] as const)("keeps the legacy keyboard destination order for %s Settings presentation", (settingsPresentation) => {
    const tabs = new AppMobileDestinationTabs();
    tabs.settingsPresentation = settingsPresentation;

    const template = tabs.render();
    expect(tabDestinations(template)).toEqual(["chat", "sessions", "tools", "settings"]);
    expect(nextDestination("settings", -1)).toBe("tools");
  });

  it("includes Tools when navigating with a keyboard", () => {
    expect(nextDestination("sessions", 1)).toBe("tools");
    expect(nextDestination("settings", -1)).toBe("tools");
  });

  it("selects every destination through its real callback", () => {
    const tabs = new AppMobileDestinationTabs();
    const onSelect = vi.fn();
    tabs.onSelect = onSelect;
    const template = tabs.render();

    callbackAfterDestination(template, "tools")();
    callbackAfterDestination(template, "settings")();

    expect(onSelect).toHaveBeenNthCalledWith(1, "tools");
    expect(onSelect).toHaveBeenNthCalledWith(2, "settings");
  });
});

function settingsTabMarkup(template: TemplateResult): string {
  return templateMarkup(settingsTab(template));
}

function settingsTab(template: TemplateResult): TemplateResult {
  const tab = tabTemplates(template).find((candidate) => templateValues(candidate)[0] === "settings");
  if (tab === undefined) throw new Error("Expected Settings tab");
  return tab;
}

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
