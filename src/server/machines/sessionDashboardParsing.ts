import type { LocalSessionDashboardResponse, LocalSessionDashboardSessionSummary } from "../../shared/sessionDashboard.js";
import { parseSessionDashboardSnapshotResponse } from "../../shared/sessionDashboard.js";

/** Strict boundary parser for remote machine dashboard metadata. */
export function parseLocalSessionDashboardResponse(value: unknown): LocalSessionDashboardResponse | undefined {
  const snapshot = parseSessionDashboardSnapshotResponse(value);
  if (snapshot === undefined || !isRecord(value) || !Array.isArray(value["sessions"])) return undefined;
  const sessions: LocalSessionDashboardSessionSummary[] = [];
  for (let index = 0; index < snapshot.sessions.length; index += 1) {
    const base = snapshot.sessions[index];
    const raw: unknown = value["sessions"][index];
    if (base === undefined || !isRecord(raw)) return undefined;
    const project = raw["project"];
    const workspace = raw["workspace"];
    if (!isRecord(project) || !isRecord(workspace)) return undefined;
    if (typeof project["id"] !== "string" || typeof project["name"] !== "string" || typeof workspace["id"] !== "string" || typeof workspace["label"] !== "string" || typeof workspace["isMain"] !== "boolean") return undefined;
    if (workspace["branch"] !== undefined && typeof workspace["branch"] !== "string") return undefined;
    sessions.push({
      ...base,
      project: { id: project["id"], name: project["name"] },
      workspace: { id: workspace["id"], label: workspace["label"], isMain: workspace["isMain"], ...(workspace["branch"] === undefined ? {} : { branch: workspace["branch"] }) },
    });
  }
  return { sessions };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
