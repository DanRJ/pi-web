// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import type { Machine, Project, SessionInfo, Workspace } from "../api";
import { MachineList } from "./MachineList";
import { ProjectList } from "./ProjectList";
import { SessionList } from "./SessionList";
import { WorkspaceList } from "./WorkspaceList";

afterEach(() => { document.body.replaceChildren(); });

describe("navigation hierarchy icons", () => {
  it("renders the machine, project, workspace, and session icons before their names", async () => {
    const machineList = new MachineList();
    machineList.machines = [machine];
    const projectList = new ProjectList();
    projectList.projects = [project];
    const workspaceList = new WorkspaceList();
    workspaceList.workspaces = [workspace];
    const sessionList = new SessionList();
    sessionList.sessions = [session];

    document.body.append(machineList, projectList, workspaceList, sessionList);
    await Promise.all([machineList.updateComplete, projectList.updateComplete, workspaceList.updateComplete, sessionList.updateComplete]);

    expectAlignedHierarchyContent(machineList, ".machine-icon", 1);
    expectAlignedHierarchyContent(projectList, ".project-icon");
    expectAlignedHierarchyContent(workspaceList, ".workspace-icon");
    expectAlignedHierarchyContent(sessionList, ".session-icon");
  });
});

function expectAlignedHierarchyContent(element: HTMLElement, iconSelector: string, iconColumn = 0): void {
  const row = element.shadowRoot?.querySelector(".hierarchy-row-content");
  const icon = row?.querySelector(iconSelector);
  const text = row?.querySelector(".hierarchy-row-text");
  expect(icon).not.toBeNull();
  expect(text).not.toBeNull();
  expect(row?.children[iconColumn]).toBe(icon);
  expect(row?.children[iconColumn + 1]).toBe(text);
}

const machine = {
  id: "local",
  name: "Local",
  kind: "local",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} satisfies Machine;

const project = {
  id: "project",
  name: "Project",
  path: "/repo",
  createdAt: "2026-01-01T00:00:00.000Z",
} satisfies Project;

const workspace = {
  id: "workspace",
  projectId: project.id,
  path: project.path,
  label: "main",
  branch: "main",
  isMain: true,
  isGitRepo: true,
  isGitWorktree: false,
} satisfies Workspace;

const session = {
  id: "session",
  cwd: project.path,
  path: "/sessions/session.jsonl",
  created: "2026-01-01T00:00:00.000Z",
  modified: "2026-01-01T00:00:00.000Z",
  messageCount: 1,
  firstMessage: "Conversation",
} satisfies SessionInfo;
