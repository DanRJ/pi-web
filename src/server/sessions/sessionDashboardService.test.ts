import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { LocalSessionDashboardService } from "./sessionDashboardService.js";

const repoPath = resolve("repo");
const project = { id: "project", name: "Project", path: repoPath, createdAt: "2026-01-01T00:00:00.000Z" };
const workspace = { id: "workspace", projectId: "project", path: repoPath, label: "main", branch: "main", isMain: true, isGitRepo: true, isGitWorktree: true };

function cwdRequestBody(value: unknown): { cwds: string[] } {
  if (!isRecord(value)) throw new Error("expected a CWD request body");
  const cwds = value["cwds"];
  if (!Array.isArray(cwds) || !cwds.every((cwd): cwd is string => typeof cwd === "string")) throw new Error("expected a CWD request body");
  return { cwds };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

describe("LocalSessionDashboardService", () => {
  it("uses one deduped daemon query, joins workspace context, and sorts newest first", async () => {
    const request = vi.fn().mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({ sessions: [
        { id: "older", cwd: repoPath, firstMessage: "old", created: "2026-01-01T00:00:00.000Z", modified: "2026-01-01T00:00:00.000Z", messageCount: 1, runtimeStatus: "idle", displayStatus: "idle", needsAttention: false },
        { id: "newer", cwd: repoPath, firstMessage: "new", created: "2026-01-02T00:00:00.000Z", modified: "2026-01-02T00:00:00.000Z", messageCount: 2, runtimeStatus: "active", displayStatus: "running", needsAttention: false },
      ] }),
    });
    const service = new LocalSessionDashboardService({
      projects: { list: () => Promise.resolve([project, { ...project, id: "overlap", name: "Overlap", createdAt: "2025-01-01T00:00:00.000Z" }]) },
      workspaces: { list: () => Promise.resolve([workspace]) },
      sessionDaemon: { request },
    });

    const response = await service.summary();
    expect(request).toHaveBeenCalledWith("POST", "/session-summaries", { cwds: [repoPath] });
    expect(response.sessions.map((session) => session.id)).toEqual(["newer", "older"]);
    expect(response.sessions[0]).toMatchObject({ project: { id: "project", name: "Project" }, workspace: { id: "workspace", branch: "main" } });
  });

  it("bounds concurrent daemon chunk requests", async () => {
    const workspaces = Array.from({ length: 501 }, (_, index) => ({ ...workspace, id: `workspace-${String(index)}`, path: resolve(repoPath, String(index)), label: String(index) }));
    const resolvers: (() => void)[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const request = vi.fn(() => new Promise<{ statusCode: number; body: string }>((resolveRequest) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      resolvers.push(() => { inFlight -= 1; resolveRequest({ statusCode: 200, body: JSON.stringify({ sessions: [] }) }); });
    }));
    const service = new LocalSessionDashboardService({ projects: { list: () => Promise.resolve([project]) }, workspaces: { list: () => Promise.resolve(workspaces) }, sessionDaemon: { request } });
    const response = service.summary();
    for (let completed = 0; completed < 6;) {
      await Promise.resolve();
      const batch = resolvers.splice(0);
      if (batch.length === 0) continue;
      completed += batch.length;
      batch.forEach((resolveRequest) => { resolveRequest(); });
    }
    await response;
    expect(request).toHaveBeenCalledTimes(6);
    expect(maxInFlight).toBeLessThanOrEqual(4);
  });

  it("chunks more than the daemon CWD limit and merges a deterministic deduped result", async () => {
    const workspaces = Array.from({ length: 101 }, (_, index) => ({ ...workspace, id: `workspace-${String(index)}`, path: resolve(repoPath, String(index)), label: String(index) }));
    const firstWorkspace = workspaces[0];
    if (firstWorkspace === undefined) throw new Error("expected a workspace");
    const request = vi.fn((_method: string, _path: string, body?: unknown) => {
      const cwds = cwdRequestBody(body).cwds;
      return Promise.resolve({
        statusCode: 200,
        body: JSON.stringify({ sessions: [
          ...cwds.map((cwd) => ({ id: `session-${cwd}`, cwd, firstMessage: "", created: "2026-01-01T00:00:00.000Z", modified: "2026-01-01T00:01:00.000Z", messageCount: 0, runtimeStatus: "idle", displayStatus: "idle", needsAttention: false })),
          { id: "duplicate", cwd: firstWorkspace.path, firstMessage: "", created: "2026-01-01T00:00:00.000Z", modified: "2026-01-02T00:00:00.000Z", messageCount: 0, runtimeStatus: "idle", displayStatus: "idle", needsAttention: false },
        ] }),
      });
    });
    const service = new LocalSessionDashboardService({
      projects: { list: () => Promise.resolve([project]) },
      workspaces: { list: () => Promise.resolve(workspaces) },
      sessionDaemon: { request },
    });

    const response = await service.summary();
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.map((call) => cwdRequestBody(call[2]).cwds.length).sort((left, right) => left - right)).toEqual([1, 100]);
    expect(response.sessions).toHaveLength(102);
    expect(response.sessions.filter((session) => session.id === "duplicate")).toHaveLength(1);
    expect(response.sessions[0]?.id).toBe("duplicate");
  });
});
