import { describe, expect, it } from "vitest";
import { normalizeSessionName, SESSION_NAME_MAX_LENGTH, sessionNameEvent } from "./sessionName.js";

describe("session name normalization", () => {
  it("turns CR/LF runs into spaces and clears null or blank names", () => {
    expect(normalizeSessionName("  Ship\r\n\nthis  ")).toBe("Ship this");
    expect(normalizeSessionName(null)).toBeUndefined();
    expect(normalizeSessionName(" \t ")).toBeUndefined();
    expect(sessionNameEvent("s1", undefined)).toEqual({ type: "session.name", sessionId: "s1" });
  });

  it("rejects malformed values and names over the UTF-16 limit after normalization", () => {
    expect(() => normalizeSessionName({ name: "no" })).toThrow("name field must be a string or null");
    expect(normalizeSessionName("x".repeat(SESSION_NAME_MAX_LENGTH))).toHaveLength(SESSION_NAME_MAX_LENGTH);
    expect(() => normalizeSessionName("x".repeat(SESSION_NAME_MAX_LENGTH + 1))).toThrow("at most");
  });
});
