import type { LocalSessionDashboardResponse, LocalSessionDashboardSessionSummary, SessionDashboardSnapshotResponse } from "../../shared/sessionDashboard.js";
import { parseSessionDashboardSnapshotResponse } from "../../shared/sessionDashboard.js";
import type { ProjectService } from "../projects/projectService.js";
import type { WorkspaceService } from "../workspaces/workspaceService.js";
import { canonicalizeStoredCwd } from "../workingDirectory.js";
import { MAX_SESSION_SUMMARY_CWDS } from "./sessionSummaryRoutes.js";

export interface SessionSummaryDaemon {
  request(method: string, path: string, body?: unknown): Promise<{ statusCode: number; body: string }>;
}

export interface LocalSessionDashboardServiceDependencies {
  projects: Pick<ProjectService, "list">;
  workspaces: Pick<WorkspaceService, "list">;
  sessionDaemon: SessionSummaryDaemon;
}

interface WorkspaceContext {
  cwd: string;
  project: { id: string; name: string; createdAt: string };
  workspace: { id: string; label: string; branch?: string; isMain: boolean };
}

/** Composes persisted project/workspace metadata around a single sessiond query. */
/** Avoid a dashboard read fanning out unbounded daemon requests for large workspace sets. */
export const SESSION_DASHBOARD_CHUNK_CONCURRENCY = 4;

export class LocalSessionDashboardService {
  constructor(private readonly deps: LocalSessionDashboardServiceDependencies) {}

  async summary(): Promise<LocalSessionDashboardResponse> {
    const contexts = await this.workspaceContexts();
    if (contexts.length === 0) return { sessions: [] };
    const byCwd = new Map<string, WorkspaceContext>();
    for (const context of contexts.sort(compareWorkspaceContext)) {
      if (!byCwd.has(context.cwd)) byCwd.set(context.cwd, context);
    }
    const snapshots = await mapWithConcurrency(chunk([...byCwd.keys()], MAX_SESSION_SUMMARY_CWDS), SESSION_DASHBOARD_CHUNK_CONCURRENCY, (cwds) => this.snapshot(cwds));
    const sessionsByIdentity = new Map<string, LocalSessionDashboardSessionSummary>();
    for (const snapshot of snapshots) {
      for (const session of snapshot.sessions) {
        const normalizedCwd = canonicalizeStoredCwd(session.cwd);
        const context = byCwd.get(normalizedCwd);
        if (context === undefined) continue;
        const summary: LocalSessionDashboardSessionSummary = {
          ...session,
          cwd: normalizedCwd,
          project: { id: context.project.id, name: context.project.name },
          workspace: {
            id: context.workspace.id,
            label: context.workspace.label,
            ...(context.workspace.branch === undefined ? {} : { branch: context.workspace.branch }),
            isMain: context.workspace.isMain,
          },
        };
        const identity = `${normalizedCwd}\u0000${session.id}`;
        const current = sessionsByIdentity.get(identity);
        if (current === undefined || compareSessionSummary(summary, current) < 0) sessionsByIdentity.set(identity, summary);
      }
    }
    const sessions = [...sessionsByIdentity.values()].sort(compareSessionSummary);
    return { sessions };
  }

  private async workspaceContexts(): Promise<WorkspaceContext[]> {
    const projects = await this.deps.projects.list();
    const workspacesByProject = await Promise.all(projects.map(async (project) => ({ project, workspaces: await this.deps.workspaces.list(project) })));
    return workspacesByProject.flatMap(({ project, workspaces }) => workspaces.map((workspace) => ({
      cwd: canonicalizeStoredCwd(workspace.path),
      project: { id: project.id, name: project.name, createdAt: project.createdAt },
      workspace: { id: workspace.id, label: workspace.label, ...(workspace.branch === undefined ? {} : { branch: workspace.branch }), isMain: workspace.isMain },
    })));
  }

  private async snapshot(cwds: readonly string[]): Promise<SessionDashboardSnapshotResponse> {
    const response = await this.deps.sessionDaemon.request("POST", "/session-summaries", { cwds });
    if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(`Session daemon summary request returned HTTP ${String(response.statusCode)}`);
    let body: unknown;
    try {
      body = response.body === "" ? undefined : JSON.parse(response.body);
    } catch {
      throw new Error("Session daemon summary response was not valid JSON");
    }
    const snapshot = parseSessionDashboardSnapshotResponse(body);
    if (snapshot === undefined) throw new Error("Session daemon summary response was invalid");
    return snapshot;
  }
}

function compareWorkspaceContext(left: WorkspaceContext, right: WorkspaceContext): number {
  return right.project.createdAt.localeCompare(left.project.createdAt)
    || left.project.id.localeCompare(right.project.id)
    || Number(right.workspace.isMain) - Number(left.workspace.isMain)
    || left.workspace.id.localeCompare(right.workspace.id);
}

async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, map: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  const entries = items.entries();
  const worker = async (): Promise<void> => {
    for (;;) {
      const entry = entries.next();
      if (entry.done === true) return;
      const [index, item] = entry.value;
      // Await each request in the worker so failures and late rejections stay observed.
      results[index] = await map(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function compareSessionSummary(left: LocalSessionDashboardSessionSummary, right: LocalSessionDashboardSessionSummary): number {
  return right.modified.localeCompare(left.modified)
    || left.id.localeCompare(right.id)
    || left.cwd.localeCompare(right.cwd);
}
