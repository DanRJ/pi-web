import type { TemplateResult } from "lit";
import { describe, expect, it } from "vitest";
import { ToolExecutionView } from "./ToolExecutionView";

describe("ToolExecutionView state semantics", () => {
  it.each(["pending", "running", "success", "error"] as const)("renders a state class for %s executions", (status) => {
    const view = new ToolExecutionView();
    view.execution = { type: "toolExecution", toolName: "edit", summary: "Update a file", status };

    const rendered = view.render();
    if (rendered === null) throw new Error("Expected a tool execution card");
    expect(templateValuesDeep(rendered)).toContain(`tool-card tool-card-${status} ${status}`);
  });

  it("keeps error presentation semantic so Modernist can use ink without changing legacy danger styling", () => {
    const styles = ToolExecutionView.styles.cssText;
    expect(styles).toContain("--pi-tool-error-card-border");
    expect(styles).toContain("--pi-tool-error-card-background");
    expect(styles).toContain("--pi-tool-error-header-rule-width");
    expect(styles).toContain("--pi-tool-error-icon-color");
    expect(styles).toContain("--pi-tool-error-text-color");
  });

  it("uses semantic running-indicator hooks so non-Modernist themes retain their dot", () => {
    const styles = ToolExecutionView.styles.cssText;
    expect(styles).toContain("--pi-tool-running-indicator-glyph-font-size, inherit");
    expect(styles).toContain("--pi-tool-running-indicator-display, inline");
    expect(styles).toContain("--pi-tool-running-indicator-spinner-size, auto");
    expect(styles).toContain("--pi-tool-running-indicator-spinner-border-width, 0px");
    expect(styles).toContain("--pi-tool-running-indicator-animation, none");

    const view = new ToolExecutionView();
    view.execution = { type: "toolExecution", toolName: "edit", summary: "Update a file", status: "running" };
    const rendered = view.render();
    if (rendered === null) throw new Error("Expected a tool execution card");
    expect(templateValuesDeep(rendered)).toContain("●");
  });

  it("retains diff line state classes for additions and removals", () => {
    const view = new ToolExecutionView();
    view.execution = {
      type: "toolExecution",
      toolName: "edit",
      summary: "Update a file",
      status: "success",
      details: { diff: "--- a/file.ts\n+++ b/file.ts\n-old value\n+new value" },
    };

    const rendered = view.render();
    if (rendered === null) throw new Error("Expected a tool execution card");
    expect(templateValuesDeep(rendered)).toEqual(expect.arrayContaining(["removed", "added"]));
  });
});

function templateValuesDeep(template: TemplateResult): unknown[] {
  const values: unknown[] = [];
  visit(template);
  return values;

  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isTemplateResult(value)) {
      values.push(value);
      return;
    }
    templateValues(value).forEach(visit);
  }
}

function templateValues(template: TemplateResult): unknown[] {
  const values = Reflect.get(template, "values");
  return Array.isArray(values) ? values : [];
}

function isTemplateResult(value: unknown): value is TemplateResult {
  return typeof value === "object" && value !== null && Array.isArray(Reflect.get(value, "strings")) && Array.isArray(Reflect.get(value, "values"));
}
