import { describe, expect, it } from "vitest";
import type { Machine } from "../../api";
import { AppNavigationPanel, shouldShowMachinesSection, visibleNavigationSections } from "./AppNavigationPanel";
import { templateText } from "../../templateInspection.testSupport";

describe("shouldShowMachinesSection", () => {
  it("hides machine navigation when there is no machine choice", () => {
    expect(shouldShowMachinesSection([])).toBe(false);
    expect(shouldShowMachinesSection([machine("local")])).toBe(false);
  });

  it("shows machine navigation when there are multiple machines", () => {
    expect(shouldShowMachinesSection([machine("local"), machine("remote-a")])).toBe(true);
  });

  it("keeps a lone local Machine in the Modernist hierarchy and preserves section focus order", () => {
    const panel = new AppNavigationPanel();
    panel.hierarchy = true;
    panel.machines = [machine("local")];

    expect(templateText(panel.render())).not.toContain("<header>");
    expect(templateText(panel.render())).toContain("<machine-list");
    expect(visibleNavigationSections(panel.machines, true)).toEqual(["machines", "projects", "workspaces", "sessions"]);
  });
});

function machine(id: string): Machine {
  return {
    id,
    name: id,
    kind: id === "local" ? "local" : "remote",
    createdAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:00.000Z",
  };
}
