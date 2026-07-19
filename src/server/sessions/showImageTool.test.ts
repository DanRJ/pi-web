import { mkdir, mkdtemp, open, readFile, rename, rm, stat, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ResizedImage } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_INLINE_IMAGE_BASE64_BYTES } from "../../shared/promptAttachments.js";
import { MAX_IMAGE_PREVIEW_BYTES } from "../../shared/workspaceFiles.js";
import { createShowImageToolDefinition, imageDimensionsFromBytes, type ShowImageFileAccess, type ShowImageFileHandle, type ShowImageResizeWorker, type ShowImageToolOptions } from "./showImageTool.js";

const tempDirs: string[] = [];
// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- show_image does not read the extension context.
const unusedContext = {} as ExtensionContext;
const validPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9JwAAAABJRU5ErkJggg==", "base64");

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi-web-show-image-"));
  tempDirs.push(root);
  return root;
}

function execute(root: string, path: string, caption?: string, options?: ShowImageToolOptions, signal?: AbortSignal) {
  return createShowImageToolDefinition(root, options).execute(
    "show-image-1",
    { path, ...(caption === undefined ? {} : { caption }) },
    signal,
    undefined,
    unusedContext,
  );
}

function resized(overrides: Partial<ResizedImage> = {}): ResizedImage {
  return {
    data: validPng.toString("base64"),
    mimeType: "image/png",
    originalWidth: 1,
    originalHeight: 1,
    width: 1,
    height: 1,
    wasResized: false,
    ...overrides,
  };
}

function statResult(size: number, ino = 1) {
  return { size, dev: 1, ino, isFile: () => true };
}

function fakeFileAccess(handle: ShowImageFileHandle, current = statResult(validPng.byteLength)): ShowImageFileAccess {
  return { open: vi.fn(() => Promise.resolve(handle)), stat: vi.fn(() => Promise.resolve(current)) };
}

function readHandle(data: Buffer, size = data.byteLength, ino = 1): ShowImageFileHandle {
  let position = 0;
  return {
    stat: () => Promise.resolve(statResult(size, ino)),
    read: (buffer, offset, length) => {
      const copied = data.copy(buffer, offset, position, position + length);
      position += copied;
      return Promise.resolve({ bytesRead: copied, buffer });
    },
    close: () => Promise.resolve(),
  };
}

function pngHeader(width: number, height: number): Buffer {
  const header = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(header);
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12, "ascii");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header;
}

function jpegHeader(width: number, height: number): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x08, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x01]);
}

function gifHeader(width: number, height: number): Buffer {
  const header = Buffer.alloc(10);
  header.write("GIF89a", 0, "ascii");
  header.writeUInt16LE(width, 6);
  header.writeUInt16LE(height, 8);
  return header;
}

function webpVp8xHeader(width: number, height: number): Buffer {
  const header = Buffer.alloc(30);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(22, 4);
  header.write("WEBPVP8X", 8, "ascii");
  header.writeUInt32LE(10, 16);
  header.writeUIntLE(width - 1, 24, 3);
  header.writeUIntLE(height - 1, 27, 3);
  return header;
}

describe("createShowImageToolDefinition", () => {
  it("defines a strict workspace-image contract and model-use guidance", () => {
    const tool = createShowImageToolDefinition("/workspace");

    expect(tool.name).toBe("show_image");
    expect(tool.description).toContain("workspace-relative path");
    expect(tool.description).toContain("never pass a URL, base64 data, or an absolute path");
    expect(tool.promptSnippet).toBe("show_image: display a local PNG, JPEG, GIF, or WebP workspace image inline; pass only its workspace-relative path");
    expect(tool.parameters).toMatchObject({
      type: "object",
      additionalProperties: false,
      properties: {
        path: { type: "string", minLength: 1, maxLength: 1024 },
        caption: { type: "string", minLength: 1, maxLength: 240 },
      },
      required: ["path"],
    });
  });

  it("decodes, validates, and returns a valid workspace PNG through Pi's resize pipeline", async () => {
    const root = await createWorkspace();
    await mkdir(join(root, "assets"));
    await writeFile(join(root, "assets", "diagram.png"), validPng);

    const resize = vi.fn(() => Promise.resolve(resized()));
    const result = await execute(root, "assets/diagram.png", "Deployment diagram", { resize });

    expect(result.content[0]).toEqual({ type: "text", text: "Deployment diagram" });
    const image = result.content[1];
    if (image?.type !== "image") throw new Error("Expected inline image content");
    expect(image.mimeType).toBe("image/png");
    expect(typeof image.data).toBe("string");
    expect(result.details).toEqual({
      path: "assets/diagram.png",
      mimeType: "image/png",
      size: validPng.byteLength,
      caption: "Deployment diagram",
    });
    expect(JSON.stringify(result.details)).not.toContain(validPng.toString("base64"));
    expect(resize).toHaveBeenCalledWith(validPng, "image/png");
  });

  it.each([
    ["image.PNG", "image/png"],
    ["image.jpeg", "image/jpeg"],
    ["image.GIF", "image/gif"],
    ["image.webp", "image/webp"],
  ] as const)("passes supported %s extensions to the Pi image pipeline as %s", async (path, mimeType) => {
    const root = await createWorkspace();
    await writeFile(join(root, path), validPng);
    const resize = vi.fn(() => Promise.resolve(resized({ mimeType })));

    // The representative PNG is intentionally only accepted for PNG. Other
    // formats use the injected pipeline result to prove extension dispatch.
    if (mimeType !== "image/png") {
      await expect(execute(root, path, undefined, { resize })).rejects.toThrow("Image data does not match");
      return;
    }

    await expect(execute(root, path, undefined, { resize })).resolves.toMatchObject({
      content: [{ type: "image", data: validPng.toString("base64"), mimeType }],
      details: { path, mimeType, size: validPng.byteLength },
    });
    expect(resize).toHaveBeenCalledWith(validPng, mimeType);
  });

  it.each([
    ["image/png", pngHeader(640, 480)],
    ["image/jpeg", jpegHeader(640, 480)],
    ["image/gif", gifHeader(640, 480)],
    ["image/webp", webpVp8xHeader(640, 480)],
  ] as const)("reads safe %s dimensions from bounded format metadata", (mimeType, bytes) => {
    expect(imageDimensionsFromBytes(bytes, mimeType)).toEqual({ width: 640, height: 480 });
  });

  it.each([
    ["bomb.png", pngHeader(8_193, 1)],
    ["bomb.jpeg", jpegHeader(8_193, 1)],
    ["bomb.gif", gifHeader(8_193, 1)],
    ["bomb.webp", webpVp8xHeader(8_193, 1)],
  ] as const)("rejects oversized compressed %s metadata before resize", async (path, bytes) => {
    const root = await createWorkspace();
    await writeFile(join(root, path), bytes);
    const resize = vi.fn(() => Promise.resolve(resized()));

    await expect(execute(root, path, undefined, { resize })).rejects.toThrow("Image dimensions exceed the inline safety limit");
    expect(resize).not.toHaveBeenCalled();
  });

  it("rejects invalid, spoofed, unsupported, oversized, and remote image input", async () => {
    const root = await createWorkspace();
    await mkdir(join(root, "directory"));
    await writeFile(join(root, "note.svg"), "<svg />");
    await writeFile(join(root, "invalid.png"), "not an image");
    await writeFile(join(root, "spoofed.jpeg"), validPng);
    await writeFile(join(root, "huge.png"), "");
    await truncate(join(root, "huge.png"), MAX_IMAGE_PREVIEW_BYTES + 1);

    await expect(execute(root, "../secret.png")).rejects.toThrow("Path traversal is not allowed");
    await expect(execute(root, join(root, "note.png"))).rejects.toThrow("Absolute paths are not allowed");
    await expect(execute(root, "https://example.com/diagram.png")).rejects.toThrow("Remote URLs and data URLs are not allowed");
    await expect(execute(root, "DATA:image/png;base64,QUJD")).rejects.toThrow("Remote URLs and data URLs are not allowed");
    await expect(execute(root, "directory")).rejects.toThrow("Only PNG, JPEG, GIF, and WebP");
    await expect(execute(root, "note.svg")).rejects.toThrow("Only PNG, JPEG, GIF, and WebP");
    await expect(execute(root, "invalid.png")).rejects.toThrow("Image data does not match");
    await expect(execute(root, "spoofed.jpeg")).rejects.toThrow("Image data does not match");
    await expect(execute(root, "huge.png")).rejects.toThrow("Image is too large to show inline");
    await expect(execute(root, "missing.png")).rejects.toThrow("Path does not exist");
  });

  it("uses the default abortable resize worker in a real image smoke test", async () => {
    const root = await createWorkspace();
    const rawFixture: unknown = await readFile(join(process.cwd(), "node_modules", "@earendil-works", "pi-coding-agent", "docs", "images", "doom-extension.png"));
    if (!Buffer.isBuffer(rawFixture)) throw new Error("Expected PNG fixture bytes");
    await writeFile(join(root, "diagram.png"), rawFixture);

    await expect(execute(root, "diagram.png")).resolves.toMatchObject({
      content: [{ type: "image", mimeType: "image/png" }],
      details: { path: "diagram.png" },
    });
  }, 15_000);

  it("terminates its owned resize worker and settles as AbortError during resize", async () => {
    const root = await createWorkspace();
    await writeFile(join(root, "diagram.png"), validPng);
    const listeners = new Map<string, (value: unknown) => void>();
    const terminate = vi.fn(() => Promise.resolve(1));
    const postMessage = vi.fn();
    const worker: ShowImageResizeWorker = {
      once: (event, listener) => { listeners.set(event, listener); },
      off: (event) => { listeners.delete(event); },
      postMessage,
      terminate,
    };
    const controller = new AbortController();
    const pending = execute(root, "diagram.png", undefined, { resizeWorkerFactory: () => worker }, controller.signal);
    await vi.waitFor(() => { expect(postMessage).toHaveBeenCalledOnce(); });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(terminate).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
  });

  it("rejects images that Pi cannot decode or resize and final payloads above the inline budget", async () => {
    const root = await createWorkspace();
    await writeFile(join(root, "diagram.png"), validPng);

    await expect(execute(root, "diagram.png", undefined, { resize: () => Promise.resolve(null) })).rejects.toThrow("decoded and resized");
    await expect(execute(root, "diagram.png", undefined, {
      resize: () => Promise.resolve(resized({ data: "A".repeat(MAX_INLINE_IMAGE_BASE64_BYTES + 1) })),
    })).rejects.toThrow("inline image size limit");
  });

  it("checks the descriptor size before read and the bytes read after a replacement race", async () => {
    const root = await createWorkspace();
    await writeFile(join(root, "diagram.png"), validPng);
    const close = vi.fn(() => Promise.resolve());
    const requestedLengths: number[] = [];
    const read = vi.fn((buffer: Buffer, _offset: number, length: number) => {
      requestedLengths.push(length);
      buffer.fill(0);
      return Promise.resolve({ bytesRead: length, buffer });
    });
    const handle: ShowImageFileHandle = { stat: () => Promise.resolve(statResult(1)), read, close };
    const resize = vi.fn(() => Promise.resolve(resized()));

    await expect(execute(root, "diagram.png", undefined, { fileAccess: fakeFileAccess(handle), resize })).rejects.toThrow("Image is too large to show inline");
    expect(requestedLengths.reduce((total, length) => total + length, 0)).toBe(MAX_IMAGE_PREVIEW_BYTES + 1);
    expect(Math.max(...requestedLengths)).toBeLessThanOrEqual(64 * 1024);
    expect(resize).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects a descriptor whose opened identity no longer matches the revalidated path", async () => {
    const root = await createWorkspace();
    await writeFile(join(root, "diagram.png"), validPng);
    const close = vi.fn(() => Promise.resolve());
    const handle = readHandle(validPng, validPng.byteLength, 10);
    handle.close = close;

    await expect(execute(root, "diagram.png", undefined, {
      fileAccess: fakeFileAccess(handle, statResult(validPng.byteLength, 11)),
      resize: () => Promise.resolve(resized()),
    })).rejects.toThrow("Image changed while it was being opened");
    // Identity mismatch is rejected before the descriptor can be read.
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects pre-aborted and in-flight aborted reads while closing the opened handle", async () => {
    const root = await createWorkspace();
    await writeFile(join(root, "diagram.png"), validPng);
    const beforeOpen = new AbortController();
    beforeOpen.abort();
    await expect(execute(root, "diagram.png", undefined, undefined, beforeOpen.signal)).rejects.toMatchObject({ name: "AbortError" });

    let signalReadStarted: (() => void) | undefined;
    let releaseRead: (() => void) | undefined;
    const readStarted = new Promise<void>((resolve) => { signalReadStarted = resolve; });
    const close = vi.fn(() => Promise.resolve());
    const handle: ShowImageFileHandle = {
      stat: () => Promise.resolve(statResult(validPng.byteLength)),
      read: async (buffer, offset) => {
        signalReadStarted?.();
        await new Promise<void>((resolve) => { releaseRead = resolve; });
        validPng.copy(buffer, offset);
        return { bytesRead: validPng.byteLength, buffer };
      },
      close,
    };
    const controller = new AbortController();
    const pending = execute(root, "diagram.png", undefined, { fileAccess: fakeFileAccess(handle), resize: () => Promise.resolve(resized()) }, controller.signal);
    await readStarted;
    controller.abort();
    releaseRead?.();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects a workspace root replaced immediately before open instead of re-baselining containment", async () => {
    const container = await createWorkspace();
    const root = join(container, "workspace");
    const replacement = join(container, "replacement");
    const parkedRoot = join(container, "workspace-parked");
    await mkdir(root);
    await mkdir(replacement);
    await writeFile(join(root, "diagram.png"), validPng);
    await writeFile(join(replacement, "diagram.png"), validPng);
    const resize = vi.fn(() => Promise.resolve(resized()));
    const fileAccess: ShowImageFileAccess = {
      open: async (path, flags) => {
        // Take over the original canonical pathname between initial resolution
        // and the actual open, without relying on symlink permissions.
        await rename(root, parkedRoot);
        await rename(replacement, root);
        return open(path, flags);
      },
      stat,
    };

    await expect(execute(root, "diagram.png", undefined, { fileAccess, resize })).rejects.toThrow("Workspace root changed while image was being opened");
    expect(resize).not.toHaveBeenCalled();
  });

  it("rejects symlink escapes and a parent replaced after open when symlink creation is permitted", async () => {
    const root = await createWorkspace();
    const external = await createWorkspace();
    const outsideImage = join(external, "outside.png");
    await writeFile(outsideImage, validPng);

    if (!await trySymlink(outsideImage, join(root, "escape.png"))) return;
    await expect(execute(root, "escape.png")).rejects.toThrow("Path escapes workspace");

    const assets = join(root, "assets");
    const parkedAssets = join(root, "assets-parked");
    await mkdir(assets);
    await writeFile(join(assets, "diagram.png"), validPng);
    const fileAccess: ShowImageFileAccess = {
      open: async (path, flags) => {
        const handle = await open(path, flags);
        await rm(assets, { recursive: true });
        await symlink(external, assets, "dir");
        return handle;
      },
      stat,
    };

    // Re-resolution may observe either the escaping replacement or the brief
    // missing-parent state; both fail closed before the opened file is read.
    await expect(execute(root, "assets/diagram.png", undefined, { fileAccess })).rejects.toThrow(/Path (?:escapes workspace|does not exist)/);
    await rm(assets, { recursive: true, force: true });
    await mkdir(parkedAssets);
  });
});

async function trySymlink(target: string, path: string): Promise<boolean> {
  try {
    await symlink(target, path);
    return true;
  } catch (error: unknown) {
    if (isPermissionError(error)) return false;
    throw error;
  }
}

function isPermissionError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  const code = error.code;
  return code === "EPERM" || code === "EACCES";
}
