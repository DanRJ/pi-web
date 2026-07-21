// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import type { Machine } from "../api";
import { canRemoveMachine, MachineList } from "./MachineList";

describe("canRemoveMachine", () => {
  it("only allows remote machines to be removed from the machine list", () => {
    expect(canRemoveMachine(machine("local", "local"))).toBe(false);
    expect(canRemoveMachine(machine("remote-a", "remote"))).toBe(true);
  });

  it("uses square selected rows and a static accent dot for online machines", () => {
    const cssText = MachineList.styles.map((style) => style.cssText).join("\n");
    expect(cssText).toContain(".machine-row.selected .action-main");
    expect(cssText).toContain(".machine-row.selected.no-actions .action-main { border-radius: 0; }");
    expect(cssText).toContain(".machine-online");
    expect(cssText).toContain("border-radius: 50%; background: var(--pi-machine-online, #f97316);");
  });

  it("renders leading machine icons and exposes only online connectivity semantically", async () => {
    const list = new MachineList();
    list.machines = [machine("local", "local"), machine("remote-a", "remote")];
    list.statuses = {
      local: { machineId: "local", ok: true, checkedAt: "2026-06-04T00:00:00.000Z", status: "online" },
      "remote-a": { machineId: "remote-a", ok: false, checkedAt: "2026-06-04T00:00:00.000Z", status: "offline" },
    };
    document.body.append(list);
    await list.updateComplete;

    expect(list.shadowRoot?.querySelectorAll(".machine-icon")).toHaveLength(2);
    const online = list.shadowRoot?.querySelector<HTMLElement>(".machine-online");
    expect(online?.getAttribute("role")).toBe("img");
    expect(online?.getAttribute("aria-label")).toBe("Online");
    expect(list.shadowRoot?.querySelectorAll(".machine-online")).toHaveLength(1);
    expect(list.shadowRoot?.textContent).toContain("offline");

    list.remove();
  });
});

function machine(id: string, kind: Machine["kind"]): Machine {
  return {
    id,
    name: id,
    kind,
    createdAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:00.000Z",
  };
}
