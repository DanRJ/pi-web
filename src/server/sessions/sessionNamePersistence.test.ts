import { mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendPersistedSessionName, PersistedSessionNameVerificationError } from "./sessionNamePersistence.js";

describe("appendPersistedSessionName", () => {
  it("preserves existing bytes and appends one valid session_info entry", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-web-session-name-"));
    const path = join(dir, "session.jsonl");
    const existing = `${JSON.stringify({ type: "session", version: 3, id: "session-1", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/repo" })}\n${JSON.stringify({ type: "message", id: "a1b2c3d4", parentId: null, timestamp: "2026-01-01T00:00:01.000Z", message: { role: "user", content: "hi" } })}`;
    try {
      await writeFile(path, existing);
      await appendPersistedSessionName({ path, sessionId: "session-1", cwd: "/repo", name: "Renamed", now: () => new Date("2026-01-01T00:00:02.000Z"), createEntryId: () => "d4c3b2a1" });
      const content = await readFile(path, "utf8");
      expect(content.startsWith(existing)).toBe(true);
      const appended: unknown = JSON.parse(content.slice(existing.length + 1));
      expect(appended).toEqual({ type: "session_info", id: "d4c3b2a1", parentId: "a1b2c3d4", timestamp: "2026-01-01T00:00:02.000Z", name: "Renamed" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects symlink and non-regular listed paths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-web-session-name-"));
    const target = join(dir, "target.jsonl");
    const directory = join(dir, "directory.jsonl");
    const header = `${JSON.stringify({ type: "session", id: "session-1", cwd: "/repo" })}\n`;
    try {
      await writeFile(target, header);
      await mkdir(directory);
      await expect(appendPersistedSessionName({ path: target, sessionId: "session-1", cwd: "/repo", name: "Renamed" }, {
        lstatPath: () => Promise.resolve({ isFile: () => true, isSymbolicLink: () => true, dev: 1, ino: 1 }),
      })).rejects.toBeInstanceOf(PersistedSessionNameVerificationError);
      await expect(appendPersistedSessionName({ path: directory, sessionId: "session-1", cwd: "/repo", name: "Renamed" })).rejects.toBeInstanceOf(PersistedSessionNameVerificationError);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a path swap when the opened descriptor differs from the trusted listing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-web-session-name-"));
    const path = join(dir, "session.jsonl");
    try {
      await writeFile(path, `${JSON.stringify({ type: "session", id: "session-1", cwd: "/repo" })}\n`);
      const handle = await open(path, "r+");
      const descriptorStat = await handle.stat();
      await expect(appendPersistedSessionName({ path, sessionId: "session-1", cwd: "/repo", name: "Renamed" }, {
        // Stable synthetic identities exercise the descriptor/path race check
        // without relying on a filesystem's inode representation.
        lstatPath: () => Promise.resolve({ dev: 1, ino: 1, size: descriptorStat.size, isFile: () => true, isSymbolicLink: () => false }),
        openFile: () => Promise.resolve({
          stat: () => Promise.resolve({ dev: 1, ino: 2, size: descriptorStat.size, isFile: () => true, isSymbolicLink: () => false }),
          read: handle.read.bind(handle),
          write: handle.write.bind(handle),
          sync: handle.sync.bind(handle),
          truncate: handle.truncate.bind(handle),
          close: handle.close.bind(handle),
        }),
      })).rejects.toBeInstanceOf(PersistedSessionNameVerificationError);
      await expect(readFile(path, "utf8")).resolves.not.toContain("Renamed");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("loops short writes and rolls back a partial write failure before publishing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-web-session-name-"));
    const path = join(dir, "session.jsonl");
    const header = `${JSON.stringify({ type: "session", id: "session-1", cwd: "/repo" })}\n`;
    try {
      await writeFile(path, header);
      const partialHandle = await open(path, "r+");
      let writeCalls = 0;
      await appendPersistedSessionName({ path, sessionId: "session-1", cwd: "/repo", name: "Renamed" }, {
        openFile: () => Promise.resolve({
          stat: partialHandle.stat.bind(partialHandle),
          read: partialHandle.read.bind(partialHandle),
          write: async (bytes, offset = 0, length = bytes.length - offset) => {
            writeCalls += 1;
            const shortLength = Math.max(1, Math.floor(length / 2));
            return partialHandle.write(bytes, offset, shortLength, header.length + offset);
          },
          sync: partialHandle.sync.bind(partialHandle),
          truncate: partialHandle.truncate.bind(partialHandle),
          close: partialHandle.close.bind(partialHandle),
        }),
      });
      expect(writeCalls).toBeGreaterThan(1);
      await expect(readFile(path, "utf8")).resolves.toContain('"name":"Renamed"');

      await writeFile(path, header);
      const failingHandle = await open(path, "r+");
      let failingCalls = 0;
      await expect(appendPersistedSessionName({ path, sessionId: "session-1", cwd: "/repo", name: "Broken" }, {
        openFile: () => Promise.resolve({
          stat: failingHandle.stat.bind(failingHandle),
          read: failingHandle.read.bind(failingHandle),
          write: async (bytes, offset = 0, length = bytes.length - offset) => {
            failingCalls += 1;
            if (failingCalls > 1) throw new Error("write failed");
            return failingHandle.write(bytes, offset, Math.max(1, Math.floor(length / 2)), header.length + offset);
          },
          sync: failingHandle.sync.bind(failingHandle),
          truncate: failingHandle.truncate.bind(failingHandle),
          close: failingHandle.close.bind(failingHandle),
        }),
      })).rejects.toThrow("write failed");
      await expect(readFile(path, "utf8")).resolves.toBe(header);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not append when the trusted listing and file header disagree", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-web-session-name-"));
    const path = join(dir, "session.jsonl");
    const existing = `${JSON.stringify({ type: "session", version: 3, id: "other", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/repo" })}\n`;
    try {
      await writeFile(path, existing);
      await expect(appendPersistedSessionName({ path, sessionId: "session-1", cwd: "/repo", name: "Renamed" })).rejects.toBeInstanceOf(PersistedSessionNameVerificationError);
      await expect(readFile(path, "utf8")).resolves.toBe(existing);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
