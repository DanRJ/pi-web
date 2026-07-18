// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Machine } from "../../api";
import { SettingsMachinesPanel } from "./SettingsMachinesPanel";

const local: Machine = { id: "local", name: "Local", kind: "local", createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z" };
const remote: Machine = { id: "remote-a", name: "Lab", kind: "remote", baseUrl: "https://lab.example.test", createdAt: "now", updatedAt: "now" };

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("SettingsMachinesPanel actions", () => {
  it("wires remote configure and remove actions while local goes to its scoped settings", async () => {
    const panel = document.createElement("settings-machines-panel");
    if (!(panel instanceof SettingsMachinesPanel)) throw new Error("Expected machine settings panel");
    const configure = vi.fn();
    const remove = vi.fn();
    const select = vi.fn();
    panel.machines = [local, remote];
    panel.onConfigureMachine = configure;
    panel.onRemoveMachine = remove;
    panel.onSelectMachine = select;
    document.body.append(panel);
    await panel.updateComplete;

    button(panel, "Configure").click();
    button(panel, "Remove").click();
    button(panel, "Use local settings").click();

    expect(configure).toHaveBeenCalledWith(remote);
    expect(remove).toHaveBeenCalledWith(remote);
    expect(select).toHaveBeenCalledWith(local);
  });

  it("disables Configure while a machine-scoped settings mutation is pending", async () => {
    const panel = document.createElement("settings-machines-panel");
    if (!(panel instanceof SettingsMachinesPanel)) throw new Error("Expected machine settings panel");
    panel.machines = [remote];
    panel.configureDisabled = true;
    document.body.append(panel);
    await panel.updateComplete;

    expect(button(panel, "Configure").disabled).toBe(true);
  });

  it("renders a package name as a package label, not a runtime version", async () => {
    const panel = document.createElement("settings-machines-panel");
    if (!(panel instanceof SettingsMachinesPanel)) throw new Error("Expected machine settings panel");
    panel.machines = [remote];
    panel.machineRuntimes = {
      [remote.id]: { machineId: remote.id, ok: true, checkedAt: "now", packageName: "@scope/pi-web-package" },
    };
    document.body.append(panel);
    await panel.updateComplete;

    const row = panel.shadowRoot?.querySelector(".machine-row");
    expect(row?.textContent).toContain("Package: @scope/pi-web-package");
    expect(row?.textContent).not.toContain("PI WEB @scope/pi-web-package");
  });
});

function button(panel: SettingsMachinesPanel, label: string): HTMLButtonElement {
  const root = panel.shadowRoot;
  if (root === null) throw new Error("Expected machine settings panel shadow root");
  const element = [...root.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent.trim() === label);
  if (element === undefined) throw new Error(`Expected ${label} button`);
  return element;
}
