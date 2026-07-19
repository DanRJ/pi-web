// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_NAME_MAX_LENGTH } from "../../../shared/sessionName";
import { SessionRenameDialog } from "./SessionRenameDialog";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("SessionRenameDialog", () => {
  it("mounts a real dialog DOM and focuses and selects the current name", async () => {
    const dialog = await mount("A useful session");
    const name = input(dialog);

    expect(dialog.shadowRoot?.querySelector<HTMLElement>("[role=dialog]")?.getAttribute("aria-modal")).toBe("true");
    expect(dialog.shadowRoot?.activeElement).toBe(name);
    expect(name.value).toBe("A useful session");
    expect(name.selectionStart).toBe(0);
    expect(name.selectionEnd).toBe(name.value.length);
  });

  it("renders parent errors and clears a name through the mounted controls", async () => {
    const onSave = vi.fn<(name: string | null) => Promise<void>>().mockResolvedValue();
    const dialog = await mount("Keep me", onSave);

    dialog.error = "This session is no longer available.";
    await dialog.updateComplete;
    expect(dialog.shadowRoot?.querySelector("[role=alert]")?.textContent).toContain("no longer available");

    await click(dialog, "Clear");
    expect(onSave).toHaveBeenCalledWith(null);
  });

  it("enforces and reports the maximum name length", async () => {
    const onSave = vi.fn<(name: string | null) => Promise<void>>().mockResolvedValue();
    const dialog = await mount("", onSave);
    const name = input(dialog);
    const tooLong = "x".repeat(SESSION_NAME_MAX_LENGTH + 1);

    expect(name.maxLength).toBe(SESSION_NAME_MAX_LENGTH);
    name.value = tooLong;
    name.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await dialog.updateComplete;
    expect(dialog.shadowRoot?.querySelector("#rename-count")?.textContent).toContain(`${String(SESSION_NAME_MAX_LENGTH + 1)} of ${String(SESSION_NAME_MAX_LENGTH)}`);

    await click(dialog, "Save");
    expect(onSave).not.toHaveBeenCalled();
    expect(dialog.shadowRoot?.querySelector("[role=alert]")?.textContent).toContain(`at most ${String(SESSION_NAME_MAX_LENGTH)} characters`);
  });
});

async function mount(name: string, onSave?: (name: string | null) => Promise<void>): Promise<SessionRenameDialog> {
  const dialog = document.createElement("session-rename-dialog");
  if (!(dialog instanceof SessionRenameDialog)) throw new Error("Expected session rename dialog");
  dialog.name = name;
  if (onSave !== undefined) dialog.onSave = onSave;
  document.body.append(dialog);
  await settle(dialog);
  return dialog;
}

function input(dialog: SessionRenameDialog): HTMLInputElement {
  const element = dialog.shadowRoot?.querySelector<HTMLInputElement>("input");
  if (element === null || element === undefined) throw new Error("Expected rename input");
  return element;
}

function button(dialog: SessionRenameDialog, label: string): HTMLButtonElement {
  const element = [...(dialog.shadowRoot?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
    .find((candidate) => candidate.textContent.trim() === label);
  if (element === undefined) throw new Error(`Expected ${label} button`);
  return element;
}

async function click(dialog: SessionRenameDialog, label: string): Promise<void> {
  button(dialog, label).click();
  await settle(dialog);
}

async function settle(dialog: SessionRenameDialog): Promise<void> {
  await dialog.updateComplete;
  await Promise.resolve();
  await dialog.updateComplete;
}
