import type { SessionUiEvent } from "./apiTypes.js";

export const SESSION_NAME_MAX_LENGTH = 120;

/**
 * Normalizes the display-name value persisted in Pi session_info entries.
 * CR/LF runs are made single spaces so a name is always one visual line.
 */
export function normalizeSessionName(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") throw new Error("name field must be a string or null");
  const name = value.replace(/[\r\n]+/gu, " ").trim();
  if (name === "") return undefined;
  if (name.length > SESSION_NAME_MAX_LENGTH) throw new Error(`name must be at most ${String(SESSION_NAME_MAX_LENGTH)} characters`);
  return name;
}

/** Keeps clear events compact while preserving the established event contract. */
export function sessionNameEvent(sessionId: string, name: string | undefined): Extract<SessionUiEvent, { type: "session.name" }> {
  return name === undefined ? { type: "session.name", sessionId } : { type: "session.name", sessionId, name };
}
