import { parentPort } from "node:worker_threads";
import { resizeImage } from "@earendil-works/pi-coding-agent";

interface ResizeRequest {
  inputBytes: Uint8Array;
  mimeType: string;
}

function isResizeRequest(value: unknown): value is ResizeRequest {
  return value !== null
    && typeof value === "object"
    && "inputBytes" in value
    && value.inputBytes instanceof Uint8Array
    && "mimeType" in value
    && typeof value.mimeType === "string";
}

const port = parentPort;
if (port === null) throw new Error("show_image resize worker requires parentPort");

port.once("message", (message: unknown) => {
  void (async () => {
    try {
      if (!isResizeRequest(message)) throw new Error("Invalid show_image resize request");
      const result = await resizeImage(message.inputBytes, message.mimeType);
      port.postMessage({ result });
    } catch (error: unknown) {
      port.postMessage({ error: error instanceof Error ? error.message : String(error) });
    }
  })();
});
