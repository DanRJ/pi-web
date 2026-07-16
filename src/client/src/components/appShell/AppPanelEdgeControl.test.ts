import type { TemplateResult } from "lit";
import { describe, expect, it } from "vitest";
import { MODERNIST_NAVIGATION_PANEL_DEFAULT_WIDTH, PanelResizeController } from "../../appShell/panelResizeController";
import { AppPanelEdgeControl } from "./AppPanelEdgeControl";

describe("AppPanelEdgeControl", () => {
  it("announces the controller's effective Modernist default before a panel has been resized", () => {
    const controller = new PanelResizeController(new FakeHost(), { storage: new FakeStorage() });
    const constraints = controller.constraints("navigation", { defaultWidth: MODERNIST_NAVIGATION_PANEL_DEFAULT_WIDTH });
    const control = new AppPanelEdgeControl();
    control.resizable = true;
    control.panelWidth = controller.panelWidth("navigation", undefined, constraints);

    const template = templateWithMarker(control.render(), "aria-valuenow=");
    if (template === undefined) throw new Error("Expected resize-handle template");
    const strings = templateStrings(template);
    const values = templateValues(template);
    const valueIndex = strings.findIndex((part) => part.includes("aria-valuenow="));

    expect(values[valueIndex]).toBe("264");
  });
});

function templateStrings(template: TemplateResult): readonly string[] {
  const strings = Reflect.get(template, "strings");
  if (!Array.isArray(strings) || !strings.every((part: unknown) => typeof part === "string")) throw new Error("Template strings were unavailable");
  return strings;
}

function templateValues(template: TemplateResult): readonly unknown[] {
  const values = Reflect.get(template, "values");
  if (!Array.isArray(values)) throw new Error("Template values were unavailable");
  return values;
}

function templateWithMarker(template: TemplateResult, marker: string): TemplateResult | undefined {
  if (templateStrings(template).join("").includes(marker)) return template;
  for (const value of templateValues(template)) {
    if (isTemplateResult(value)) {
      const nested = templateWithMarker(value, marker);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

function isTemplateResult(value: unknown): value is TemplateResult {
  return typeof value === "object" && value !== null && Array.isArray(Reflect.get(value, "strings"));
}

class FakeHost {
  readonly updateComplete = Promise.resolve(true);

  addController(): void {
    return;
  }

  removeController(): void {
    return;
  }

  requestUpdate(): void {
    return;
  }
}

class FakeStorage {
  getItem(): null {
    return null;
  }

  setItem(): void {
    return;
  }

  removeItem(): void {
    return;
  }
}
