// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Machine } from "../api";
import { MachineDialog, type MachineDialogSubmit } from "./MachineDialog";

const remote: Machine = {
  id: "remote-a",
  name: "Lab Mac",
  kind: "remote",
  baseUrl: "https://lab.example.test",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

const local: Machine = { id: "local", name: "Local", kind: "local", createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z" };

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("MachineDialog edit", () => {
  it("prefills a remote without exposing its token and keeps a blank token unchanged", async () => {
    const submitted = vi.fn<(input: MachineDialogSubmit) => Promise<void>>().mockResolvedValue();
    const dialog = await mount(remote, submitted);

    expect(input(dialog, "name").value).toBe("Lab Mac");
    expect(input(dialog, "baseUrl").value).toBe("https://lab.example.test");
    expect(input(dialog, "token").value).toBe("");
    expect(dialog.shadowRoot?.activeElement).toBe(input(dialog, "name"));

    await submit(dialog);
    expect(submitted).toHaveBeenCalledWith({ name: "Lab Mac", baseUrl: "https://lab.example.test" });
  });

  it("sends an explicit empty token only after clearing the stored token", async () => {
    const submitted = vi.fn<(input: MachineDialogSubmit) => Promise<void>>().mockResolvedValue();
    const dialog = await mount(remote, submitted);

    await click(dialog, "Clear stored token");
    await submit(dialog);

    expect(submitted).toHaveBeenCalledWith({ name: "Lab Mac", baseUrl: "https://lab.example.test", token: "" });
  });

  it("rejects the local machine instead of rendering an editable connection form", async () => {
    const submitted = vi.fn<(input: MachineDialogSubmit) => Promise<void>>().mockResolvedValue();
    const dialog = await mount(local, submitted);

    expect(dialog.shadowRoot?.querySelector("input")).toBeNull();
    expect(dialog.shadowRoot?.querySelector("[role=alert]")?.textContent).toContain("cannot be edited");
    expect(dialog.shadowRoot?.querySelector("button.primary")).toBeNull();
    await submit(dialog);
    expect(submitted).not.toHaveBeenCalled();
  });
});

async function mount(machine: Machine, onSubmit: (input: MachineDialogSubmit) => Promise<void>): Promise<MachineDialog> {
  const dialog = document.createElement("machine-dialog");
  if (!(dialog instanceof MachineDialog)) throw new Error("Expected machine dialog");
  dialog.machine = machine;
  dialog.onSubmit = onSubmit;
  document.body.append(dialog);
  await dialog.updateComplete;
  return dialog;
}

function input(dialog: MachineDialog, name: string): HTMLInputElement {
  const element = dialog.shadowRoot?.querySelector<HTMLInputElement>(`input[name=${name}]`);
  if (element === null || element === undefined) throw new Error(`Expected ${name} input`);
  return element;
}

function button(dialog: MachineDialog, label: string): HTMLButtonElement {
  const root = dialog.shadowRoot;
  if (root === null) throw new Error("Expected machine dialog shadow root");
  const element = [...root.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent.trim() === label);
  if (element === undefined) throw new Error(`Expected ${label} button`);
  return element;
}

async function click(dialog: MachineDialog, label: string): Promise<void> {
  button(dialog, label).click();
  await dialog.updateComplete;
}

async function submit(dialog: MachineDialog): Promise<void> {
  const form = dialog.shadowRoot?.querySelector("form");
  if (form === null || form === undefined) throw new Error("Expected form");
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await settle(dialog);
}

async function settle(dialog: MachineDialog): Promise<void> {
  await dialog.updateComplete;
  await Promise.resolve();
  await dialog.updateComplete;
}
