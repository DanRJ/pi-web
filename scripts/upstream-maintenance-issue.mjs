#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { readCurrentMaintenanceReport } from "./upstream-maintenance-lib.mjs";
import { buildIssueBody, collectOpenIssues, maintenanceIssuePlan } from "./upstream-maintenance-issue-lib.mjs";

const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
if (!repository || !token) throw new Error("GITHUB_REPOSITORY and GITHUB_TOKEN are required.");

const gitDirectory = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-dir"], { cwd: process.cwd(), encoding: "utf8", windowsHide: true }).trim();
const reportDirectory = resolve(process.cwd(), process.argv[2] ?? resolve(gitDirectory, "pi-web-maintenance"));
const { report } = readCurrentMaintenanceReport(reportDirectory);
if (report.status !== "update-available") process.exit(0);
const title = "Upstream maintenance update available";
const body = buildIssueBody(report);
const headers = { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" };

async function request(path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, { ...options, headers: { ...headers, ...options.headers } });
  if (!response.ok) throw new Error(`GitHub API ${options.method ?? "GET"} ${path} failed: ${response.status}`);
  return { body: response.status === 204 ? null : await response.json(), link: response.headers.get("link") };
}

const issues = await collectOpenIssues(async (nextPage) => {
  const { body, link } = await request(nextPage ?? `/repos/${repository}/issues?state=open&per_page=100`);
  return { issues: body, link };
});
const plan = maintenanceIssuePlan(issues, title, body);
if (plan.create) {
  await request(`/repos/${repository}/issues`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(plan.create) });
} else if (plan.update) {
  await request(`/repos/${repository}/issues/${plan.update.number}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: plan.update.title, body: plan.update.body }) });
}
