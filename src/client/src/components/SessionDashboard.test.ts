import { describe, expect, it } from "vitest";
import { relativeTime } from "./SessionDashboard";

describe("SessionDashboard presentation helpers", () => {
  it("uses a truthful fallback for invalid relative timestamps", () => {
    expect(relativeTime("not-a-date", Date.now())).toBe("Unknown time");
  });

  it("formats local relative time without depending on server labels", () => {
    expect(relativeTime("2026-01-01T00:01:00.000Z", Date.parse("2026-01-01T00:00:00.000Z"))).toContain("minute");
  });
});
