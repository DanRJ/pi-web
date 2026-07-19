// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import type { AuthDialogState } from "../appState";
import { AuthDialog } from "./AuthDialog";

afterEach(() => {
  document.body.replaceChildren();
});

const localTarget = { id: "local", kind: "local" as const, requestKey: JSON.stringify(["local"]) };

describe("AuthDialog focus handoff", () => {
  it("moves focus off the exposed Settings control for login method choices", async () => {
    const { dialog, behind } = await mount({ step: "method", target: localTarget });

    expect(document.activeElement).not.toBe(behind);
    expect(dialog.shadowRoot?.activeElement).toBe(closeButton(dialog));
  });

  it("keeps focus in the dialog when delayed logout choices arrive", async () => {
    const { dialog, behind } = await mount({ step: "logout", target: localTarget, providers: [] });
    dialog.state = { step: "logout", target: localTarget, providers: [provider()] };
    await dialog.updateComplete;

    expect(document.activeElement).not.toBe(behind);
    expect(dialog.shadowRoot?.activeElement).toBe(closeButton(dialog));
  });

  it("announces a machine revision conflict as an accessible auth error", async () => {
    const { dialog } = await mount({
      step: "apiKey",
      target: localTarget,
      provider: { id: "openai", name: "OpenAI", authType: "api_key", status: { configured: false } },
      value: "key",
      error: "Machine connection changed; reload settings and try again.",
    });

    expect(dialog.shadowRoot?.querySelector("[role='alert']")?.textContent).toContain("Machine connection changed");
  });

  it("focuses an in-dialog control for a failed login flow", async () => {    const { dialog, behind } = await mount({
      step: "oauth",
      target: localTarget,
      flow: { flowId: "login-1", providerId: "openai", providerName: "OpenAI", status: "error", progress: [], error: "Login failed" },
    });

    expect(document.activeElement).not.toBe(behind);
    expect(dialog.shadowRoot?.activeElement).toBe(closeButton(dialog));
  });
});

async function mount(state: AuthDialogState): Promise<{ dialog: AuthDialog; behind: HTMLButtonElement }> {
  const behind = document.createElement("button");
  behind.textContent = "Settings";
  document.body.append(behind);
  behind.focus();
  const dialog = document.createElement("auth-dialog");
  if (!(dialog instanceof AuthDialog)) throw new Error("Expected auth dialog");
  dialog.state = state;
  document.body.append(dialog);
  await dialog.updateComplete;
  return { dialog, behind };
}

function provider() {
  return { id: "openai", name: "OpenAI", authType: "oauth" as const, status: { configured: true } };
}

function closeButton(dialog: AuthDialog): HTMLButtonElement {
  const button = dialog.shadowRoot?.querySelector<HTMLButtonElement>("header button");
  if (button === null || button === undefined) throw new Error("Expected close button");
  return button;
}
