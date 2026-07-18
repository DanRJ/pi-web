// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { PiWebApp } from "./PiWebApp";

describe("PiWebApp Settings auth handoff", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(["login", "logout"] as const)("closes Settings without restoring focus before opening %s auth", (mode) => {
    const app = createApp();
    const events: string[] = [];
    const closeSettings = vi.fn((options: { restoreFocus?: boolean }) => { events.push(options.restoreFocus === false ? "close:false" : "close:true"); });
    const auth = {
      openLogin: vi.fn(() => { events.push("login"); }),
      openLogout: vi.fn(() => { events.push("logout"); }),
    };
    Reflect.set(app, "closeSettings", closeSettings);
    Reflect.set(app, "auth", auth);

    call(app, "openSettingsAuth", mode);

    expect(closeSettings).toHaveBeenCalledWith({ restoreFocus: false });
    expect(mode === "login" ? auth.openLogin : auth.openLogout).toHaveBeenCalledOnce();
    expect(events).toEqual(["close:false", mode]);
  });
});

function createApp(): PiWebApp {
  const media = { matches: false, addEventListener: () => undefined, removeEventListener: () => undefined };
  vi.stubGlobal("window", {
    location: { href: "http://localhost/", pathname: "/", search: "", hash: "" },
    history: { pushState: () => undefined, replaceState: () => undefined },
    localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
    matchMedia: () => media,
  });
  return new PiWebApp();
}

function call(app: PiWebApp, name: string, ...args: unknown[]): void {
  const method: unknown = Reflect.get(app, name);
  if (typeof method !== "function") throw new Error(`Missing ${name}`);
  method.call(app, ...args);
}
