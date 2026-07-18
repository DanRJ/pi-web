import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CapturingSessionEventHub, emptyArchiveStore, fakeRuntime, runtimeCreator, sessionGateway, sessionRecord, sessionRef } from "./piSessionService.testSupport.js";
import { PiSessionService, SessionRenameArchivedError, SessionRenameNotFoundError } from "./piSessionService.js";
import { appendPersistedSessionName } from "./sessionNamePersistence.js";

const TEST_AGENT_DIR = "/tmp/pi-web-test-agent";

describe("PiSessionService.rename", () => {
  it("renames an active busy runtime without interrupting work", async () => {
    const hub = new CapturingSessionEventHub();
    const fake = fakeRuntime("active", { isStreaming: true });
    const service = new PiSessionService(hub, { agentDir: TEST_AGENT_DIR, createAgentRuntime: runtimeCreator(fake.runtime), sessionManager: sessionGateway([]), archiveStore: emptyArchiveStore(), heartbeatIntervalMs: 60_000 });
    try {
      await service.start("/workspace");
      await expect(service.rename(sessionRef("active"), "Working title")).resolves.toEqual({ sessionId: "active", name: "Working title" });
      expect(fake.session.sessionName).toBe("Working title");
      expect(fake.calls.abort).toBe(0);
      expect(fake.calls.dispose).toBe(0);
      expect(hub.globalEvents).toContainEqual({ type: "session.name", sessionId: "active", name: "Working title" });
    } finally {
      await service.dispose();
    }
  });

  it("appends a dormant name from its trusted cwd listing without opening a runtime", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-web-rename-"));
    const path = join(dir, "dormant.jsonl");
    const hub = new CapturingSessionEventHub();
    const open = vi.fn();
    const record = { ...sessionRecord("dormant"), path };
    const service = new PiSessionService(hub, {
      agentDir: TEST_AGENT_DIR,
      sessionManager: { create: () => { throw new Error("not used"); }, list: () => Promise.resolve([record]), open, },
      archiveStore: emptyArchiveStore(),
      heartbeatIntervalMs: 60_000,
    });
    try {
      await writeFile(path, `${JSON.stringify({ type: "session", version: 3, id: "dormant", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/workspace" })}\n`);
      await expect(service.rename(sessionRef("dormant"), undefined)).resolves.toEqual({ sessionId: "dormant" });
      expect(open).not.toHaveBeenCalled();
      expect(JSON.parse((await readFile(path, "utf8")).trim().split("\n").at(-1) ?? "{}")).toMatchObject({ type: "session_info", parentId: null, name: "" });
      expect(hub.globalEvents).toContainEqual({ type: "session.name", sessionId: "dormant" });
    } finally {
      await service.dispose();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("serializes concurrent dormant renames before the durability boundary", async () => {
    const hub = new CapturingSessionEventHub();
    const appendedNames: string[] = [];
    let releaseFirstAppend: (() => void) | undefined;
    const firstAppend = new Promise<void>((resolve) => { releaseFirstAppend = resolve; });
    const service = new PiSessionService(hub, {
      agentDir: TEST_AGENT_DIR,
      sessionManager: sessionGateway([sessionRecord("dormant")]),
      archiveStore: emptyArchiveStore(),
      appendPersistedSessionName: ({ name }) => {
        appendedNames.push(name);
        return appendedNames.length === 1 ? firstAppend : Promise.resolve();
      },
      heartbeatIntervalMs: 60_000,
    });
    try {
      const first = service.rename(sessionRef("dormant"), "First");
      await vi.waitFor(() => { expect(appendedNames).toEqual(["First"]); });
      const second = service.rename(sessionRef("dormant"), "Second");
      await Promise.resolve();
      expect(appendedNames).toEqual(["First"]);

      releaseFirstAppend?.();
      await expect(first).resolves.toEqual({ sessionId: "dormant", name: "First" });
      await expect(second).resolves.toEqual({ sessionId: "dormant", name: "Second" });
      expect(appendedNames).toEqual(["First", "Second"]);
      expect(hub.globalEvents).toEqual([
        { type: "session.name", sessionId: "dormant", name: "First" },
        { type: "session.name", sessionId: "dormant", name: "Second" },
      ]);
    } finally {
      await service.dispose();
    }
  });

  it("makes a dormant archive wait for a rename, then archives the committed JSONL without recreating its source", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-web-rename-"));
    const path = join(dir, "dormant.jsonl");
    const record = { ...sessionRecord("dormant"), path };
    const hub = new CapturingSessionEventHub();
    let signalAppendStarted: (() => void) | undefined;
    const appendStarted = new Promise<void>((resolve) => { signalAppendStarted = resolve; });
    let releaseAppend: (() => void) | undefined;
    const appendGate = new Promise<void>((resolve) => { releaseAppend = resolve; });
    let copied = "";
    let archived = false;
    const archiveStore = {
      list: () => Promise.resolve(archived ? [{ sessionId: "dormant", cwd: "/workspace", archivedAt: "now", originalPath: path, archivePath: `${path}.archived` }] : []),
      get: () => Promise.resolve(undefined),
      isArchived: () => Promise.resolve(archived),
      restore: () => Promise.resolve(),
      archive: async (input: { path: string; sessionId: string; cwd: string }) => {
        copied = await readFile(input.path, "utf8");
        await rm(input.path);
        archived = true;
        return { sessionId: input.sessionId, cwd: input.cwd, archivedAt: "now", originalPath: input.path, archivePath: `${input.path}.archived` };
      },
    };
    const service = new PiSessionService(hub, {
      agentDir: TEST_AGENT_DIR,
      sessionManager: { create: () => { throw new Error("not used"); }, list: () => Promise.resolve(archived ? [] : [record]), open: vi.fn() },
      archiveStore,
      appendPersistedSessionName: async (input) => {
        signalAppendStarted?.();
        await appendGate;
        await appendPersistedSessionName(input);
      },
      heartbeatIntervalMs: 60_000,
    });
    try {
      await writeFile(path, `${JSON.stringify({ type: "session", id: "dormant", cwd: "/workspace" })}\n`);
      const rename = service.rename(sessionRef("dormant"), "Committed name");
      await appendStarted;
      const archive = service.archiveMany([{ id: "dormant", cwd: "/workspace" }]);
      await Promise.resolve();
      expect(copied).toBe("");
      releaseAppend?.();
      await rename;
      await archive;
      expect(copied).toContain('"name":"Committed name"');
      await expect(readFile(path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      expect(hub.globalEvents).toContainEqual({ type: "session.name", sessionId: "dormant", name: "Committed name" });
    } finally {
      await service.dispose();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("makes an in-flight open win, then renames the registered runtime instead of raw-appending", async () => {
    const fake = fakeRuntime("dormant");
    let releaseOpen: (() => void) | undefined;
    const openGate = new Promise<void>((resolve) => { releaseOpen = resolve; });
    let signalOpen: (() => void) | undefined;
    const openStarted = new Promise<void>((resolve) => { signalOpen = resolve; });
    const append = vi.fn();
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      sessionManager: sessionGateway([sessionRecord("dormant")]),
      archiveStore: emptyArchiveStore(),
      createAgentRuntime: async () => { signalOpen?.(); await openGate; return fake.runtime; },
      appendPersistedSessionName: append,
      heartbeatIntervalMs: 60_000,
    });
    try {
      const opening = service.status(sessionRef("dormant"));
      await openStarted;
      const rename = service.rename(sessionRef("dormant"), "Runtime name");
      releaseOpen?.();
      await opening;
      await expect(rename).resolves.toEqual({ sessionId: "dormant", name: "Runtime name" });
      expect(fake.session.sessionName).toBe("Runtime name");
      expect(append).not.toHaveBeenCalled();
    } finally {
      await service.dispose();
    }
  });

  it("makes a rename win before opening so the runtime observes the committed name", async () => {
    const fake = fakeRuntime("dormant");
    let committedName: string | undefined;
    let releaseAppend: (() => void) | undefined;
    const appendGate = new Promise<void>((resolve) => { releaseAppend = resolve; });
    let signalAppend: (() => void) | undefined;
    const appendStarted = new Promise<void>((resolve) => { signalAppend = resolve; });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      sessionManager: sessionGateway([sessionRecord("dormant")]),
      archiveStore: emptyArchiveStore(),
      createAgentRuntime: () => { fake.session.sessionName = committedName; return Promise.resolve(fake.runtime); },
      appendPersistedSessionName: async ({ name }) => { signalAppend?.(); await appendGate; committedName = name; },
      heartbeatIntervalMs: 60_000,
    });
    try {
      const rename = service.rename(sessionRef("dormant"), "Committed first");
      await appendStarted;
      const opening = service.status(sessionRef("dormant"));
      releaseAppend?.();
      await rename;
      await opening;
      expect(fake.session.sessionName).toBe("Committed first");
    } finally {
      await service.dispose();
    }
  });

  it("rejects stale and archived sessions without opening a runtime, and emits no event when append fails", async () => {
    const hub = new CapturingSessionEventHub();
    const append = vi.fn(() => Promise.reject(new Error("disk full")));
    const service = new PiSessionService(hub, {
      agentDir: TEST_AGENT_DIR,
      sessionManager: { create: () => { throw new Error("not used"); }, list: () => Promise.resolve([sessionRecord("present")]), open: vi.fn() },
      archiveStore: { ...emptyArchiveStore(), get: (id) => Promise.resolve(id === "archived" ? { sessionId: id, cwd: "/workspace", archivedAt: "2026-01-01T00:00:00.000Z" } : undefined) },
      appendPersistedSessionName: append,
      heartbeatIntervalMs: 60_000,
    });
    try {
      await expect(service.rename(sessionRef("missing"), "Name")).rejects.toBeInstanceOf(SessionRenameNotFoundError);
      await expect(service.rename(sessionRef("archived"), "Name")).rejects.toBeInstanceOf(SessionRenameArchivedError);
      await expect(service.rename(sessionRef("present"), "Name")).rejects.toThrow("disk full");
      expect(hub.globalEvents).toEqual([]);
    } finally {
      await service.dispose();
    }
  });
});
