import { describe, expect, it } from "vitest";
import {
  CONTROLLED_LABEL,
  ISSUE_MARKER,
  WATCHER_AUTHOR,
  buildIssueBody,
  collectOpenIssues,
  maintenanceIssuePlan,
} from "./upstream-maintenance-issue-lib.mjs";

function controlledIssue(number, body = ISSUE_MARKER) {
  return { number, body, pull_request: undefined, user: { login: WATCHER_AUTHOR }, labels: [{ name: CONTROLLED_LABEL }] };
}

describe("upstream maintenance issue updater", () => {
  it("requires hidden marker, controlled label, and github-actions author while escaping untrusted report text", () => {
    const body = buildIssueBody({
      baseline: { sha: "base" }, refs: { origin: "origin", upstream: "upstream" }, ancestry: { leftCount: 1, rightCount: 2 }, mergeSimulation: { clean: false },
      signals: { "api<script>\n@team": ["path `* @team\u202E"] }, upstream: { commits: [{ sha: "abc", subject: "<b>@all</b>" }] },
    });
    expect(body).toContain(ISSUE_MARKER);
    expect(body).not.toContain("<b>");
    expect(body).not.toContain("@all");
    expect(body).not.toContain("@team");
    expect(body).toContain("\\u202E");
    expect(body).toContain("\\`");
    const plan = maintenanceIssuePlan([
      { number: 1, body, pull_request: undefined, user: { login: "attacker" }, labels: [{ name: CONTROLLED_LABEL }] },
      { number: 2, body: "not marker", pull_request: undefined, user: { login: WATCHER_AUTHOR }, labels: [{ name: CONTROLLED_LABEL }] },
      { number: 3, body, pull_request: undefined, user: { login: WATCHER_AUTHOR }, labels: [] },
      { number: 4, body, pull_request: { url: "pull" }, user: { login: WATCHER_AUTHOR }, labels: [{ name: CONTROLLED_LABEL }] },
      controlledIssue(9, body),
    ], "title", body);
    expect(plan.update?.number).toBe(9);
    expect(plan.create).toBeNull();
  });

  it("paginates beyond 100 open issues so a managed issue cannot be duplicated", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({ number: index + 1 }));
    const secondPage = [controlledIssue(101)];
    const seen = [];
    const issues = await collectOpenIssues(async (path) => {
      seen.push(path);
      return path === null
        ? { issues: firstPage, link: '<https://api.github.com/repos/DanRJ/pi-web/issues?state=open&per_page=100&page=2>; rel="next"' }
        : { issues: secondPage, link: null };
    });
    expect(issues).toHaveLength(101);
    expect(seen).toEqual([null, "/repos/DanRJ/pi-web/issues?state=open&per_page=100&page=2"]);
    expect(maintenanceIssuePlan(issues, "title", "body").update?.number).toBe(101);
  });

  it("refuses duplicate controlled issues instead of closing or guessing", () => {
    expect(() => maintenanceIssuePlan([controlledIssue(4), controlledIssue(9)], "title", "body")).toThrow("Refusing to update 2 controlled maintenance issues");
  });

  it("creates a labeled controlled issue only when none exists", () => {
    expect(maintenanceIssuePlan([], "title", "body")).toEqual({
      create: { title: "title", body: "body", labels: [CONTROLLED_LABEL] },
      update: null,
    });
  });
});
