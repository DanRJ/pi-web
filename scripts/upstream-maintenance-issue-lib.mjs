import { escapeMarkdown } from "./upstream-maintenance-lib.mjs";

export const ISSUE_MARKER = "<!-- pi-web-upstream-maintenance -->";
export const CONTROLLED_LABEL = "upstream-maintenance";
export const WATCHER_AUTHOR = "github-actions[bot]";

function markdownCode(value) {
  return `\`${escapeMarkdown(value)}\``;
}

function markdownText(value) {
  return escapeMarkdown(value);
}

export function buildIssueBody(report) {
  const commits = Array.isArray(report?.upstream?.commits) ? report.upstream.commits.slice(0, 20) : [];
  const signals = report?.signals && typeof report.signals === "object" ? Object.entries(report.signals) : [];
  const lines = [
    ISSUE_MARKER,
    "## Upstream maintenance update available",
    "",
    `- Baseline: ${markdownCode(report?.baseline?.sha ?? "unknown")}`,
    `- Origin: ${markdownCode(report?.refs?.origin ?? "unknown")}`,
    `- Upstream: ${markdownCode(report?.refs?.upstream ?? "unknown")}`,
    `- Fork-only commits: ${Number(report?.ancestry?.leftCount ?? 0)}`,
    `- Upstream-only commits: ${Number(report?.ancestry?.rightCount ?? 0)}`,
    `- Merge simulation: ${report?.mergeSimulation?.clean === true ? "clean" : "conflicts"}`,
    "",
    "### Signals",
    "",
    ...signals.map(([name, paths]) => `- ${markdownText(name)}: ${Array.isArray(paths) && paths.length > 0 ? paths.map(markdownText).join(", ") : "none"}`),
    "",
    "### Upstream commits",
    "",
    ...(commits.length === 0 ? ["- None"] : commits.map((commit) => `- ${markdownCode(commit.sha)} ${markdownText(commit.subject)}`)),
    "",
    "Upstream-derived text is untrusted. Review the deterministic maintenance report before proposing an integration.",
  ];
  return `${lines.join("\n")}\n`;
}

export function isManagedMaintenanceIssue(issue) {
  return !issue?.pull_request
    && typeof issue?.body === "string"
    && issue.body.includes(ISSUE_MARKER)
    && issue.user?.login === WATCHER_AUTHOR
    && Array.isArray(issue.labels)
    && issue.labels.some((label) => label?.name === CONTROLLED_LABEL);
}

/** A duplicate is a stop condition: never guess which bot-owned issue is authoritative. */
export function maintenanceIssuePlan(issues, title, body) {
  const managed = issues.filter(isManagedMaintenanceIssue).sort((a, b) => a.number - b.number);
  if (managed.length > 1) throw new Error(`Refusing to update ${managed.length} controlled maintenance issues; resolve duplicates first.`);
  if (managed.length === 0) return { create: { title, body, labels: [CONTROLLED_LABEL] }, update: null };
  return { create: null, update: { number: managed[0].number, title, body } };
}

/** Extract the next GitHub API page without following an arbitrary Link target. */
export function nextIssuePagePath(linkHeader) {
  if (typeof linkHeader !== "string") return null;
  const next = linkHeader.split(",").map((entry) => entry.trim()).find((entry) => /;\s*rel="?next"?\s*$/i.test(entry));
  if (!next) return null;
  const match = /^<([^>]+)>/.exec(next);
  if (!match) throw new Error("GitHub pagination Link header is malformed.");
  const url = new URL(match[1]);
  if (url.origin !== "https://api.github.com" || !url.pathname.startsWith("/repos/")) throw new Error("GitHub pagination Link target is invalid.");
  return `${url.pathname}${url.search}`;
}

/** Fetches all pages because a managed issue outside page one must still block duplication. */
export async function collectOpenIssues(fetchPage) {
  const issues = [];
  let path = null;
  do {
    const page = await fetchPage(path);
    if (!Array.isArray(page?.issues)) throw new Error("GitHub issues response is not an array.");
    issues.push(...page.issues);
    path = nextIssuePagePath(page.link);
  } while (path !== null);
  return issues;
}
