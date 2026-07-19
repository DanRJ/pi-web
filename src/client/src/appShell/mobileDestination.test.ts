import { describe, expect, it } from "vitest";
import { mobileDestinationFromMainView } from "./mobileDestination";

describe("mobile destinations", () => {
  it("keeps the four canonical destinations independent from desktop main-view state", () => {
    expect(mobileDestinationFromMainView("chat")).toBe("chat");
    expect(mobileDestinationFromMainView("navigation")).toBe("sessions");
    expect(mobileDestinationFromMainView("plugin:workspace.review")).toBe("tools");
  });

});
