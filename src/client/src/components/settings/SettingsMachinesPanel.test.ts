import { describe, expect, it } from "vitest";
import type { Machine, MachineHealth, MachineRuntime } from "../../api";
import type { TemplateResult } from "lit";
import { SettingsMachinesPanel, machineStatus } from "./SettingsMachinesPanel";

const remote: Machine = {
  id: "remote-a",
  name: "Lab Mac",
  kind: "remote",
  baseUrl: "https://lab.example.test",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

describe("machine settings status", () => {
  it("uses reported health rather than claiming a remote is online", () => {
    const health: MachineHealth = { machineId: remote.id, ok: false, checkedAt: "now", status: "offline" };
    expect(machineStatus(remote, health, undefined)).toEqual({ label: "offline", tone: "offline" });
  });

  it("uses a successful runtime only when no health result is available", () => {
    const runtime: MachineRuntime = { machineId: remote.id, ok: true, checkedAt: "now" };
    expect(machineStatus(remote, undefined, runtime)).toEqual({ label: "online", tone: "online" });
  });

  it("offers configured remote actions without inventing host details", () => {
    const panel = new SettingsMachinesPanel();
    panel.machines = [remote];

    const markup = templateMarkup(panel.render());

    expect(markup).toContain("Configure");
    expect(markup).toContain("Remove");
    expect(markup).not.toContain("OS");
  });

  it("never treats a package name as the PI WEB runtime version", () => {
    const panel = new SettingsMachinesPanel();
    panel.machines = [remote];
    panel.machineRuntimes = {
      [remote.id]: { machineId: remote.id, ok: true, checkedAt: "now", packageName: "@scope/pi-web-package" },
    };

    const markup = templateMarkup(panel.render());

    expect(markup).not.toContain("PI WEB @scope/pi-web-package");
    expect(markup).toContain("Package: ");
  });
});

function templateMarkup(template: TemplateResult): string {
  return `${template.strings.join("")}${template.values.map((value) => nestedMarkup(value)).join("")}`;
}

function nestedMarkup(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => nestedMarkup(item)).join("");
  return isTemplateResult(value) ? templateMarkup(value) : "";
}

function isTemplateResult(value: unknown): value is TemplateResult {
  return typeof value === "object" && value !== null && Array.isArray(Reflect.get(value, "strings")) && Array.isArray(Reflect.get(value, "values"));
}
