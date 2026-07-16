import { constants } from "node:fs";
import { open, stat } from "node:fs/promises";
import type { Stats } from "node:fs";
import { Worker } from "node:worker_threads";
import { Type } from "typebox";
import { defineTool, resizeImage } from "@earendil-works/pi-coding-agent";
import type { ResizedImage } from "@earendil-works/pi-coding-agent";
import { MAX_INLINE_IMAGE_BASE64_BYTES } from "../../shared/promptAttachments.js";
import { MAX_IMAGE_PREVIEW_BYTES, MAX_IMAGE_PREVIEW_LABEL } from "../../shared/workspaceFiles.js";
import { imageMimeTypeForPath } from "../workspaces/imagePreviewService.js";
import { resolveWorkspacePathAccessTarget } from "../workspaces/pathAccessPolicy.js";

const ShowImageParams = Type.Object({
  path: Type.String({
    minLength: 1,
    maxLength: 1024,
    description: "Workspace-relative path to a PNG, JPEG, GIF, or WebP image. Do not use URLs, base64 data, or absolute paths.",
  }),
  caption: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 240,
    description: "Optional concise caption to display with the image.",
  })),
}, { additionalProperties: false });

const IMAGE_READ_CHUNK_BYTES = 64 * 1024;
const MAX_IMAGE_DIMENSION = 8_192;
const MAX_IMAGE_PIXELS = 32_000_000;

export interface ShowImageToolDetails {
  path: string;
  mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  size: number;
  caption?: string;
}

export interface ImageDimensions {
  width: number;
  height: number;
}

type FileStats = Pick<Stats, "size" | "dev" | "ino"> & { isFile(): boolean };

export interface ShowImageFileHandle {
  stat(): Promise<FileStats>;
  read(buffer: Buffer, offset: number, length: number, position: number | null): Promise<{ bytesRead: number; buffer: Buffer }>;
  close(): Promise<void>;
}

/** Filesystem boundary kept small so replacement races are deterministic in tests. */
export interface ShowImageFileAccess {
  open(path: string, flags: number): Promise<ShowImageFileHandle>;
  stat(path: string): Promise<FileStats>;
}

export interface ShowImageResizeWorker {
  once(event: "message" | "error" | "exit", listener: (value: unknown) => void): unknown;
  off(event: "message" | "error" | "exit", listener: (value: unknown) => void): unknown;
  postMessage(value: unknown, transferList?: readonly Transferable[]): void;
  terminate(): Promise<number>;
}

export interface ShowImageToolOptions {
  fileAccess?: ShowImageFileAccess;
  /** Test seam for checking output handling without starting Photon. */
  resize?: typeof resizeImage;
  /** Test seam for observing owned worker lifetime. */
  resizeWorkerFactory?: () => ShowImageResizeWorker;
}

const defaultFileAccess: ShowImageFileAccess = { open, stat };

function rejectRemoteImageSource(path: string): void {
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(path) || /^data:/i.test(path)) {
    throw new Error("Remote URLs and data URLs are not allowed");
  }
}

function inlineImageMimeTypeForPath(path: string): ShowImageToolDetails["mimeType"] | undefined {
  const mimeType = imageMimeTypeForPath(path);
  switch (mimeType) {
    case "image/png":
    case "image/jpeg":
    case "image/gif":
    case "image/webp":
      return mimeType;
    case undefined:
    default:
      return undefined;
  }
}

function noFollowReadFlags(): number {
  // O_NOFOLLOW protects the final component on POSIX (including WSL). Windows
  // does not support it, so canonical revalidation and handle identity checks
  // below remain the portable containment defence.
  return constants.O_RDONLY | (process.platform === "win32" ? 0 : constants.O_NOFOLLOW);
}

function sameFileIdentity(left: FileStats, right: FileStats): boolean {
  // Node exposes the OS file ID as dev/ino on POSIX and Windows. Comparing it
  // catches a renamed-and-replaced root even when the replacement takes over
  // the exact same canonical pathname.
  return left.dev === right.dev && left.ino === right.ino;
}

function sameCanonicalPath(left: string, right: string): boolean {
  // Canonical Windows paths are case-insensitive; POSIX paths are not.
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function imageMimeTypeFromBytes(bytes: Buffer): ShowImageToolDetails["mimeType"] | undefined {
  if (bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && (bytes.subarray(0, 6).toString("ascii") === "GIF87a" || bytes.subarray(0, 6).toString("ascii") === "GIF89a")) return "image/gif";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return undefined;
}

function imageMetadataError(): Error {
  return new Error("Image dimensions could not be read safely");
}

function pngDimensions(bytes: Buffer): ImageDimensions {
  if (bytes.length < 24 || bytes.readUInt32BE(8) !== 13 || bytes.subarray(12, 16).toString("ascii") !== "IHDR") throw imageMetadataError();
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function gifDimensions(bytes: Buffer): ImageDimensions {
  if (bytes.length < 10) throw imageMetadataError();
  return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
}

function isJpegStartOfFrame(marker: number): boolean {
  return (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
}

function jpegDimensions(bytes: Buffer): ImageDimensions {
  let offset = 2;
  while (offset < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) throw imageMetadataError();
    const marker = bytes[offset++];
    if (marker === undefined || marker === 0x00 || marker === 0xd9 || marker === 0xda) throw imageMetadataError();
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) throw imageMetadataError();
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) throw imageMetadataError();
    if (isJpegStartOfFrame(marker)) {
      if (length < 8) throw imageMetadataError();
      return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  throw imageMetadataError();
}

function webpDimensions(bytes: Buffer): ImageDimensions {
  if (bytes.length < 20) throw imageMetadataError();
  const riffEnd = bytes.readUInt32LE(4) + 8;
  if (riffEnd < 20 || riffEnd > bytes.length) throw imageMetadataError();
  let offset = 12;
  while (offset + 8 <= riffEnd) {
    const type = bytes.subarray(offset, offset + 4).toString("ascii");
    const length = bytes.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    const chunkEnd = dataOffset + length;
    if (chunkEnd < dataOffset || chunkEnd > riffEnd) throw imageMetadataError();
    if (type === "VP8X") {
      if (length < 10) throw imageMetadataError();
      return {
        width: bytes.readUIntLE(dataOffset + 4, 3) + 1,
        height: bytes.readUIntLE(dataOffset + 7, 3) + 1,
      };
    }
    if (type === "VP8 ") {
      if (length < 10 || bytes[dataOffset + 3] !== 0x9d || bytes[dataOffset + 4] !== 0x01 || bytes[dataOffset + 5] !== 0x2a) throw imageMetadataError();
      return {
        width: bytes.readUInt16LE(dataOffset + 6) & 0x3fff,
        height: bytes.readUInt16LE(dataOffset + 8) & 0x3fff,
      };
    }
    if (type === "VP8L") {
      if (length < 5 || bytes[dataOffset] !== 0x2f) throw imageMetadataError();
      const packed = bytes.readUInt32LE(dataOffset + 1);
      return { width: (packed & 0x3fff) + 1, height: ((packed >>> 14) & 0x3fff) + 1 };
    }
    const nextOffset = chunkEnd + (length % 2);
    if (nextOffset > riffEnd) throw imageMetadataError();
    offset = nextOffset;
  }
  throw imageMetadataError();
}

/** Reads dimensions from format headers only; it never invokes an image decoder. */
export function imageDimensionsFromBytes(bytes: Buffer, mimeType: ShowImageToolDetails["mimeType"]): ImageDimensions {
  switch (mimeType) {
    case "image/png": return pngDimensions(bytes);
    case "image/jpeg": return jpegDimensions(bytes);
    case "image/gif": return gifDimensions(bytes);
    case "image/webp": return webpDimensions(bytes);
  }
}

function validateImageDimensions(bytes: Buffer, mimeType: ShowImageToolDetails["mimeType"]): void {
  const { width, height } = imageDimensionsFromBytes(bytes, mimeType);
  if (width < 1 || height < 1 || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION || width * height > MAX_IMAGE_PIXELS) {
    throw new Error("Image dimensions exceed the inline safety limit");
  }
}

async function readBoundedImage(handle: ShowImageFileHandle, signal: AbortSignal | undefined): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytesRead = 0;
  const readLimit = MAX_IMAGE_PREVIEW_BYTES + 1;
  while (bytesRead < readLimit) {
    signal?.throwIfAborted();
    const requestLength = Math.min(IMAGE_READ_CHUNK_BYTES, readLimit - bytesRead);
    const chunk = Buffer.allocUnsafe(requestLength);
    const result = await handle.read(chunk, 0, requestLength, bytesRead);
    signal?.throwIfAborted();
    if (!Number.isSafeInteger(result.bytesRead) || result.bytesRead < 0 || result.bytesRead > requestLength) throw new Error("Invalid image file read result");
    if (result.bytesRead === 0) break;
    chunks.push(chunk.subarray(0, result.bytesRead));
    bytesRead += result.bytesRead;
  }
  if (bytesRead > MAX_IMAGE_PREVIEW_BYTES) throw new Error(`Image is too large to show inline (limit ${MAX_IMAGE_PREVIEW_LABEL})`);
  return Buffer.concat(chunks, bytesRead);
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

function defaultResizeWorker(): ShowImageResizeWorker {
  const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
  return new Worker(new URL(`./showImageResizeWorker.${extension}`, import.meta.url));
}

function isResizeWorkerMessage(value: unknown): value is { result?: ResizedImage | null; error?: string } {
  return value !== null && typeof value === "object";
}

function errorFromUnknown(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

async function resizeInOwnedWorker(bytes: Buffer, mimeType: ShowImageToolDetails["mimeType"], signal: AbortSignal | undefined, factory: () => ShowImageResizeWorker): Promise<ResizedImage | null> {
  signal?.throwIfAborted();
  const worker = factory();
  const workerBytes = new Uint8Array(bytes);
  return new Promise<ResizedImage | null>((resolve, reject) => {
    let settled = false;
    const removeListeners = () => {
      worker.off("message", onMessage);
      worker.off("error", onError);
      worker.off("exit", onExit);
      signal?.removeEventListener("abort", onAbort);
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      removeListeners();
      void worker.terminate().catch(() => undefined).finally(() => {
        callback();
      });
    };
    const onMessage = (value: unknown) => {
      if (!isResizeWorkerMessage(value)) {
        finish(() => { reject(new Error("Invalid image resize worker response")); });
      } else if (typeof value.error === "string") {
        finish(() => { reject(new Error(value.error)); });
      } else {
        finish(() => { resolve(value.result ?? null); });
      }
    };
    const onError = (error: unknown) => {
      finish(() => { reject(errorFromUnknown(error)); });
    };
    const onExit = (code: unknown) => {
      finish(() => { reject(new Error(`Image resize worker exited with code ${String(code)}`)); });
    };
    const onAbort = () => {
      finish(() => { reject(abortError()); });
    };
    worker.once("message", onMessage);
    worker.once("error", onError);
    worker.once("exit", onExit);
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      worker.postMessage({ inputBytes: workerBytes, mimeType }, [workerBytes.buffer]);
    } catch (error: unknown) {
      finish(() => { reject(errorFromUnknown(error)); });
    }
  });
}

async function resizeWorkspaceImage(bytes: Buffer, expectedMimeType: ShowImageToolDetails["mimeType"], options: ShowImageToolOptions, signal: AbortSignal | undefined): Promise<{ data: string; mimeType: ShowImageToolDetails["mimeType"] }> {
  if (imageMimeTypeFromBytes(bytes) !== expectedMimeType) throw new Error("Image data does not match its file type");
  validateImageDimensions(bytes, expectedMimeType);
  signal?.throwIfAborted();
  // The injected function preserves fast, deterministic unit tests. Production
  // resizing always crosses this owned worker boundary, which is terminated on
  // cancellation (and takes Pi's nested Photon worker down with it).
  const resized = options.resize === undefined
    ? await resizeInOwnedWorker(bytes, expectedMimeType, signal, options.resizeWorkerFactory ?? defaultResizeWorker)
    : await options.resize(bytes, expectedMimeType);
  signal?.throwIfAborted();
  const mimeType = resized === null ? undefined : supportedInlineMimeType(resized.mimeType);
  if (mimeType === undefined || resized === null) throw new Error("Image could not be decoded and resized for inline display");
  if (Buffer.byteLength(resized.data, "utf8") > MAX_INLINE_IMAGE_BASE64_BYTES) throw new Error("Resized image exceeds the inline image size limit");
  return { data: resized.data, mimeType };
}

function supportedInlineMimeType(value: string): ShowImageToolDetails["mimeType"] | undefined {
  switch (value) {
    case "image/png":
    case "image/jpeg":
    case "image/gif":
    case "image/webp":
      return value;
    default:
      return undefined;
  }
}

/**
 * Returns a decoded, validated, and Pi-resized image from the session workspace
 * as native Pi image content. The opened descriptor is the sole read source:
 * path containment and file identity are rechecked after opening so a replaced
 * path or parent cannot redirect a read outside the workspace.
 */
export function createShowImageToolDefinition(cwd: string, options: ShowImageToolOptions = {}) {
  const fileAccess = options.fileAccess ?? defaultFileAccess;
  return defineTool<typeof ShowImageParams, ShowImageToolDetails>({
    name: "show_image",
    label: "Show image",
    description: "Show a PNG, JPEG, GIF, or WebP image from a workspace-relative path inline to the user. Use this only for local workspace images; never pass a URL, base64 data, or an absolute path.",
    promptSnippet: "show_image: display a local PNG, JPEG, GIF, or WebP workspace image inline; pass only its workspace-relative path",
    parameters: ShowImageParams,
    async execute(_toolCallId, params, signal) {
      signal?.throwIfAborted();
      rejectRemoteImageSource(params.path);
      const initial = await resolveWorkspacePathAccessTarget(cwd, params.path);
      // Keep the initially resolved root's identity as well as its canonical
      // pathname. Otherwise a root rename followed by a symlink, junction, or
      // replacement directory can make revalidation establish a new baseline.
      const initialRoot = await fileAccess.stat(initial.root);
      signal?.throwIfAborted();

      const mimeType = inlineImageMimeTypeForPath(initial.displayPath);
      if (mimeType === undefined) throw new Error("Only PNG, JPEG, GIF, and WebP images can be shown inline");

      const handle = await fileAccess.open(initial.target, noFollowReadFlags());
      try {
        const opened = await handle.stat();
        signal?.throwIfAborted();
        if (!opened.isFile()) throw new Error("Path is not a file");
        if (opened.size > MAX_IMAGE_PREVIEW_BYTES) throw new Error(`Image is too large to show inline (limit ${MAX_IMAGE_PREVIEW_LABEL})`);

        // Re-resolve both the workspace root and requested target after opening.
        // The root must still be the initially resolved directory: without this,
        // a root rename plus symlink/junction/replacement can re-baseline
        // containment before the descriptor identity is checked.
        const revalidated = await resolveWorkspacePathAccessTarget(cwd, params.path);
        const revalidatedRoot = await fileAccess.stat(revalidated.root);
        if (!sameCanonicalPath(initial.root, revalidated.root) || !sameFileIdentity(initialRoot, revalidatedRoot)) {
          throw new Error("Workspace root changed while image was being opened");
        }
        const current = await fileAccess.stat(revalidated.target);
        if (!sameFileIdentity(opened, current)) throw new Error("Image changed while it was being opened");
        if (!current.isFile()) throw new Error("Path is not a file");
        signal?.throwIfAborted();

        const data = await readBoundedImage(handle, signal);
        const resized = await resizeWorkspaceImage(data, mimeType, options, signal);
        const details: ShowImageToolDetails = {
          path: revalidated.displayPath,
          mimeType: resized.mimeType,
          size: opened.size,
          ...(params.caption === undefined ? {} : { caption: params.caption }),
        };
        return {
          content: [
            ...(params.caption === undefined ? [] : [{ type: "text" as const, text: params.caption }]),
            { type: "image" as const, data: resized.data, mimeType: resized.mimeType },
          ],
          details,
        };
      } finally {
        await handle.close();
      }
    },
  });
}
