import type { TemplateResult } from "lit";
import { describe, expect, it } from "vitest";
import { UnifiedDiffViewer } from "./UnifiedDiffViewer";

describe("UnifiedDiffViewer diff state markup", () => {
  it("marks added and removed rows without changing the unified diff renderer", () => {
    const viewer = new UnifiedDiffViewer();
    viewer.diff = "--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old value\n+new value";

    expect(templateValuesDeep(viewer.render())).toEqual(expect.arrayContaining([
      "cell content remove",
      "cell content add",
    ]));
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
