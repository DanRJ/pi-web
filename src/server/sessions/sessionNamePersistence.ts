import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { cwdPathsEqual } from "../workingDirectory.js";

export interface PersistedSessionNameInput {
  path: string;
  sessionId: string;
  cwd: string;
  /** An empty string is an explicit clear in Pi's session_info format. */
  name: string;
  now?: () => Date;
  createEntryId?: () => string;
}

interface FileIdentity { dev?: number; ino?: number; isFile(): boolean; isSymbolicLink(): boolean; size?: number }
interface SessionNameFileHandle {
  stat(): Promise<FileIdentity>;
  read(buffer: Buffer, offset: number, length: number, position: number | null): Promise<{ bytesRead: number }>;
  write(data: Buffer, offset?: number, length?: number, position?: number | null): Promise<{ bytesWritten: number }>;
  sync(): Promise<void>;
  truncate(length?: number): Promise<void>;
  close(): Promise<void>;
}

/** Test seam for hostile-file and short-write cases; production uses one OS descriptor. */
export interface SessionNamePersistenceDependencies {
  lstatPath?: (path: string) => Promise<FileIdentity>;
  openFile?: (path: string, flags: number) => Promise<SessionNameFileHandle>;
}

/**
 * Verify and append through one descriptor. The trusted listing's path is
 * lstat-checked before opening and compared with fstat after opening, so a
 * path replacement cannot redirect the append. Existing JSONL bytes are never
 * rewritten; a failed partial append is rolled back before this rejects.
 */
export async function appendPersistedSessionName(input: PersistedSessionNameInput, deps: SessionNamePersistenceDependencies = {}): Promise<void> {
  const listedStat = await (deps.lstatPath ?? lstat)(input.path);
  if (!isRegularNonSymlink(listedStat)) throw new PersistedSessionNameVerificationError("Session path is not a regular file");

  // O_NOFOLLOW is a no-op on platforms that do not implement it, hence the
  // lstat/fstat identity check above and below remain required everywhere.
  const handle = await (deps.openFile ?? open)(input.path, constants.O_RDWR | constants.O_APPEND | constants.O_NOFOLLOW);
  let originalSize: number | undefined;
  try {
    const descriptorStat = await handle.stat();
    if (!isRegularNonSymlink(descriptorStat) || !sameFileIdentity(listedStat, descriptorStat)) {
      throw new PersistedSessionNameVerificationError("Session file changed before it could be opened");
    }
    originalSize = descriptorStat.size;
    if (originalSize === undefined) throw new PersistedSessionNameVerificationError("Session file size is unavailable");

    const bytes = await readDescriptorFully(handle, originalSize);
    const header = parseFirstSessionHeader(bytes);
    const entries = parseSessionEntries(bytes);
    if (!isSessionHeader(header) || header.id !== input.sessionId || !cwdPathsEqual(header.cwd, input.cwd)) {
      throw new PersistedSessionNameVerificationError("Session file no longer matches the requested session");
    }

    const ids = new Set<string>();
    let parentId: string | null = null;
    for (const entry of entries.slice(1)) {
      if (!isEntry(entry)) continue;
      ids.add(entry.id);
      parentId = entry.id;
    }
    const id = uniqueEntryId(ids, input.createEntryId ?? randomSessionEntryId);
    const entry = JSON.stringify({
      type: "session_info",
      id,
      parentId,
      timestamp: (input.now ?? (() => new Date()))().toISOString(),
      name: input.name,
    });
    const separator = bytes.length === 0 || bytes[bytes.length - 1] === 0x0a ? "" : "\n";
    const appended = Buffer.from(`${separator}${entry}\n`, "utf8");

    try {
      await writeDescriptorFully(handle, appended);
      // This is the commit point. Callers publish only after it succeeds.
      await handle.sync();
    } catch (error: unknown) {
      await rollbackPartialAppend(handle, originalSize, error);
    }
  } finally {
    await handle.close();
  }
}

export class PersistedSessionNameVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersistedSessionNameVerificationError";
  }
}

async function readDescriptorFully(handle: SessionNameFileHandle, size: number): Promise<Buffer> {
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
    if (bytesRead === 0) throw new PersistedSessionNameVerificationError("Session file ended while it was being read");
    offset += bytesRead;
  }
  return bytes;
}

async function writeDescriptorFully(handle: SessionNameFileHandle, bytes: Buffer): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, null);
    if (bytesWritten === 0) throw new Error("Session name append wrote zero bytes");
    offset += bytesWritten;
  }
}

async function rollbackPartialAppend(handle: SessionNameFileHandle, originalSize: number, writeError: unknown): Promise<never> {
  try {
    await handle.truncate(originalSize);
    await handle.sync();
  } catch (rollbackError: unknown) {
    throw new Error(`Session name append failed and rollback failed: ${errorMessage(writeError)}; ${errorMessage(rollbackError)}`, { cause: rollbackError });
  }
  throw writeError;
}

function isRegularNonSymlink(stat: FileIdentity): boolean {
  return stat.isFile() && !stat.isSymbolicLink();
}

function sameFileIdentity(left: FileIdentity, right: FileIdentity): boolean {
  // Node exposes dev/ino on the supported filesystems. If a platform does not,
  // retain the type/descriptor checks instead of manufacturing a false match.
  if (left.dev === undefined || left.ino === undefined || right.dev === undefined || right.ino === undefined) return true;
  return left.dev === right.dev && left.ino === right.ino;
}

function parseFirstSessionHeader(bytes: Buffer): unknown {
  const newline = bytes.indexOf(0x0a);
  const firstLine = bytes.subarray(0, newline === -1 ? bytes.length : newline).toString("utf8");
  try {
    return JSON.parse(firstLine);
  } catch {
    return undefined;
  }
}

function parseSessionEntries(bytes: Buffer): unknown[] {
  const entries: unknown[] = [];
  for (const line of bytes.toString("utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Pi's reader skips malformed historical lines. They are left untouched;
      // only the verified header is relevant to this append-only operation.
    }
  }
  return entries;
}

function isSessionHeader(value: unknown): value is { type: "session"; id: string; cwd: string } {
  return isRecord(value) && value["type"] === "session" && typeof value["id"] === "string" && typeof value["cwd"] === "string";
}

function isEntry(value: unknown): value is { id: string } {
  return isRecord(value) && typeof value["id"] === "string";
}

function uniqueEntryId(existing: ReadonlySet<string>, createId: () => string): string {
  for (;;) {
    const id = createId();
    if (/^[a-f0-9]{8}$/u.test(id) && !existing.has(id)) return id;
  }
}

function randomSessionEntryId(): string {
  return randomBytes(4).toString("hex");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
