import { describe, expect, it } from "vitest";
import { mobileDestinationFallback, mobileDestinationFromMainView } from "./mobileDestination";

describe("mobile destinations", () => {
  it("keeps the four canonical destinations independent from desktop main-view state", () => {
    expect(mobileDestinationFromMainView("chat")).toBe("chat");
    expect(mobileDestinationFromMainView("navigation")).toBe("sessions");
    expect(mobileDestinationFromMainView("plugin:workspace.review")).toBe("tools");
  });

  it("falls back from unavailable tools without trapping a user", () => {
    expect(mobileDestinationFallback("tools", { hasSession: true, hasTools: false })).toBe("chat");
    expect(mobileDestinationFallback("tools", { hasSession: false, hasTools: false })).toBe("sessions");
    expect(mobileDestinationFallback("settings", { hasSession: false, hasTools: false })).toBe("settings");
  });
});
