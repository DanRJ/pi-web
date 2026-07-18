import type { Machine, PiWebCapability, Project, SessionActivity, SessionStatus, Workspace } from "./apiTypes.js";
import { isSessionActive } from "./activity.js";

/** Runtime state reported by sessiond without opening a session runtime. */
export type SessionDashboardRuntimeStatus = "active" | "idle" | "error";

/** Player-facing status with extension interaction given highest priority. */
export type SessionDashboardDisplayStatus = "waiting" | "running" | "errored" | "idle";

export interface SessionDashboardRuntimeSnapshot {
  status?: SessionStatus;
  activity?: SessionActivity;
  pendingExtensionUi: boolean;
}

/**
 * Derive a compact dashboard status without exposing transcripts or extension
 * request bodies. Dialog attention deliberately wins over work/error state.
 */
export function deriveSessionDashboardDisplayStatus(snapshot: SessionDashboardRuntimeSnapshot): SessionDashboardDisplayStatus {
  if (snapshot.pendingExtensionUi) return "waiting";
  if (isSessionActive(snapshot.status, snapshot.activity)) return "running";
  if (snapshot.activity?.phase === "error") return "errored";
  return "idle";
}

export function deriveSessionDashboardRuntimeStatus(snapshot: SessionDashboardRuntimeSnapshot): SessionDashboardRuntimeStatus {
  if (isSessionActive(snapshot.status, snapshot.activity)) return "active";
  if (snapshot.activity?.phase === "error") return "error";
  return "idle";
}

/** Content-free session metadata safe to aggregate across machines. */
export interface SessionDashboardSessionSummary {
  id: string;
  cwd: string;
  name?: string;
  firstMessage: string;
  created: string;
  modified: string;
  messageCount: number;
  persisted?: boolean;
  runtimeStatus: SessionDashboardRuntimeStatus;
  displayStatus: SessionDashboardDisplayStatus;
  needsAttention: boolean;
}

export interface SessionDashboardSnapshotResponse {
  sessions: SessionDashboardSessionSummary[];
}

export function parseSessionDashboardSnapshotResponse(value: unknown): SessionDashboardSnapshotResponse | undefined {
  if (!isRecord(value) || !Array.isArray(value["sessions"])) return undefined;
  const sessions = value["sessions"].map(parseSessionDashboardSessionSummary);
  return sessions.every((session): session is SessionDashboardSessionSummary => session !== undefined) ? { sessions } : undefined;
}

function parseSessionDashboardSessionSummary(value: unknown): SessionDashboardSessionSummary | undefined {
  if (!isRecord(value)) return undefined;
  const id = value["id"];
  const cwd = value["cwd"];
  const firstMessage = value["firstMessage"];
  const created = value["created"];
  const modified = value["modified"];
  const messageCount = value["messageCount"];
  const runtimeStatus = value["runtimeStatus"];
  const displayStatus = value["displayStatus"];
  const needsAttention = value["needsAttention"];
  if (typeof id !== "string" || typeof cwd !== "string" || typeof firstMessage !== "string" || !isIsoTimestamp(created) || !isIsoTimestamp(modified) || typeof messageCount !== "number" || !Number.isSafeInteger(messageCount) || messageCount < 0 || typeof needsAttention !== "boolean") return undefined;
  if (runtimeStatus !== "active" && runtimeStatus !== "idle" && runtimeStatus !== "error") return undefined;
  if (displayStatus !== "waiting" && displayStatus !== "running" && displayStatus !== "errored" && displayStatus !== "idle") return undefined;
  const name = value["name"];
  const persisted = value["persisted"];
  if (name !== undefined && typeof name !== "string") return undefined;
  if (persisted !== undefined && typeof persisted !== "boolean") return undefined;
  return { id, cwd, firstMessage, created, modified, messageCount, runtimeStatus, displayStatus, needsAttention, ...(name === undefined ? {} : { name }), ...(persisted === undefined ? {} : { persisted }) };
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface SessionDashboardProjectContext {
  id: Project["id"];
  name: Project["name"];
}

export interface SessionDashboardWorkspaceContext {
  id: Workspace["id"];
  label: Workspace["label"];
  branch?: Workspace["branch"];
  isMain: Workspace["isMain"];
}

export interface LocalSessionDashboardSessionSummary extends SessionDashboardSessionSummary {
  project: SessionDashboardProjectContext;
  workspace: SessionDashboardWorkspaceContext;
}

export interface LocalSessionDashboardResponse {
  sessions: LocalSessionDashboardSessionSummary[];
}

export type SessionDashboardMachineOutcome =
  /** Effective capabilities at dashboard-read time; omitted by older machines. */
  | { machine: Machine; outcome: "available"; sessions: LocalSessionDashboardSessionSummary[]; capabilities?: PiWebCapability[] }
  | { machine: Machine; outcome: "unsupported"; error?: string }
  | { machine: Machine; outcome: "offline"; error?: string }
  | { machine: Machine; outcome: "error"; error: string };

/** A partial dashboard response: one bad machine never hides another's sessions. */
export interface FederatedSessionDashboardResponse {
  machines: SessionDashboardMachineOutcome[];
}
