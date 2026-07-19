import http from "node:http";
import { WebSocket } from "ws";
import { isHostAbsoluteAgentDir, isSafeAgentCommandForHost } from "../config.js";
import type { ActiveAgentProfileDescriptor } from "../shared/apiTypes.js";
import { parsePiWebRuntimeComponent } from "../shared/piWebStatusParsing.js";
import type { RestartReadinessReason, SessionDaemonRestartReadiness } from "../server/sessiond/restartReadiness.js";
import { sessiondHttpUrl, sessiondSocketPath } from "./config.js";

export type SessionDaemonAgentProfileResult =
  | { status: "available"; profile: ActiveAgentProfileDescriptor }
  | { status: "unavailable"; error: string }
  | { status: "invalid"; error: string };

export type SessionDaemonRestartReadinessResult =
  | { status: "available"; readiness: SessionDaemonRestartReadiness }
  | { status: "unavailable"; error: string }
  | { status: "invalid"; error: string };

export interface SessionDaemonRequestClient {
  request(method: string, path: string, body?: unknown): Promise<{ statusCode: number; headers: Record<string, string>; body: string }>;
}

export class SessionDaemonClient {
  private readonly baseUrl = sessiondHttpUrl();
  private readonly socketPath = sessiondSocketPath();

  async request(method: string, path: string, body?: unknown): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    if (this.baseUrl !== undefined && this.baseUrl !== "") return this.requestUrl(method, path, payload);
    return this.requestSocket(method, path, payload);
  }

  getActiveAgentProfile(): Promise<SessionDaemonAgentProfileResult> {
    return getSessionDaemonActiveAgentProfile(this);
  }

  getRestartReadiness(): Promise<SessionDaemonRestartReadinessResult> {
    return getSessionDaemonRestartReadiness(this);
  }

  connectWebSocket(path: string): WebSocket {
    if (this.baseUrl !== undefined && this.baseUrl !== "") {
      const url = new URL(path, this.baseUrl);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      return new WebSocket(url);
    }
    return new WebSocket(`ws+unix:${this.socketPath}:${path}`);
  }

  private async requestUrl(method: string, path: string, payload?: string) {
    const init: RequestInit = { method };
    if (payload !== undefined && payload !== "") {
      init.headers = { "content-type": "application/json" };
      init.body = payload;
    }
    const response = await fetch(new URL(path, this.baseUrl), init);
    return {
      statusCode: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.text(),
    };
  }

  private requestSocket(method: string, path: string, payload?: string): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
    return new Promise((resolve, reject) => {
      const request = http.request(
        {
          socketPath: this.socketPath,
          path,
          method,
          headers: payload !== undefined && payload !== ""
            ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }
            : undefined,
        },
        (response) => {
          const chunks: Uint8Array[] = [];
          response.on("data", (chunk: Buffer | string) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          response.on("end", () => {
            resolve({
              statusCode: response.statusCode ?? 500,
              headers: Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : value ?? ""])),
              body: Buffer.concat(chunks).toString("utf8"),
            });
          });
        },
      );
      request.on("error", reject);
      if (payload !== undefined && payload !== "") request.write(payload);
      request.end();
    });
  }
}

export async function getSessionDaemonActiveAgentProfile(client: SessionDaemonRequestClient): Promise<SessionDaemonAgentProfileResult> {
  let response: Awaited<ReturnType<SessionDaemonRequestClient["request"]>>;
  try {
    response = await client.request("GET", "/runtime");
  } catch (error) {
    return { status: "unavailable", error: errorMessage(error) };
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    return { status: "unavailable", error: `session daemon runtime request returned HTTP ${String(response.statusCode)}` };
  }

  let value: unknown;
  try {
    value = response.body === "" ? undefined : JSON.parse(response.body);
  } catch {
    return { status: "invalid", error: "session daemon runtime response was not valid JSON" };
  }

  const runtime = parsePiWebRuntimeComponent(value);
  if (runtime?.component !== "sessiond") {
    return { status: "invalid", error: "session daemon runtime response was invalid" };
  }
  if (runtime.activeAgentProfile === undefined) {
    return { status: "invalid", error: "session daemon runtime response did not include an active agent profile" };
  }
  if (!isSafeAgentCommandForHost(runtime.activeAgentProfile.command) || !isHostAbsoluteAgentDir(runtime.activeAgentProfile.dir)) {
    return { status: "invalid", error: "session daemon active agent profile was not valid for this host" };
  }
  return { status: "available", profile: runtime.activeAgentProfile };
}

export async function getSessionDaemonRestartReadiness(client: SessionDaemonRequestClient): Promise<SessionDaemonRestartReadinessResult> {
  let response: Awaited<ReturnType<SessionDaemonRequestClient["request"]>>;
  try {
    response = await client.request("GET", "/restart-readiness");
  } catch (error) {
    return { status: "unavailable", error: errorMessage(error) };
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    return { status: "unavailable", error: `session daemon restart readiness request returned HTTP ${String(response.statusCode)}` };
  }

  let value: unknown;
  try {
    value = response.body === "" ? undefined : JSON.parse(response.body);
  } catch {
    return { status: "invalid", error: "session daemon restart readiness response was not valid JSON" };
  }

  const readiness = parseSessionDaemonRestartReadiness(value);
  return readiness === undefined
    ? { status: "invalid", error: "session daemon restart readiness response was invalid" }
    : { status: "available", readiness };
}

export function parseSessionDaemonRestartReadiness(value: unknown): SessionDaemonRestartReadiness | undefined {
  if (!isRecord(value)) return undefined;
  const keys = Object.keys(value).sort();
  const expectedKeys = ["busySessions", "loadedSessions", "reasons", "runningTerminals", "safeToRestart"];
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) return undefined;

  const safeToRestart = value["safeToRestart"];
  const loadedSessions = value["loadedSessions"];
  const busySessions = value["busySessions"];
  const runningTerminals = value["runningTerminals"];
  const reasons = value["reasons"];
  if (
    typeof safeToRestart !== "boolean"
    || !isNonNegativeSafeInteger(loadedSessions)
    || !isNonNegativeSafeInteger(busySessions)
    || !isNonNegativeSafeInteger(runningTerminals)
    || !Array.isArray(reasons)
    || !reasons.every(isRestartReadinessReason)
    || busySessions > loadedSessions
  ) return undefined;

  const expectedReasons: RestartReadinessReason[] = [];
  if (busySessions > 0) expectedReasons.push("busy-sessions");
  if (runningTerminals > 0) expectedReasons.push("running-terminals");
  if (safeToRestart !== (expectedReasons.length === 0) || !arraysEqual(reasons, expectedReasons)) return undefined;

  return { safeToRestart, loadedSessions, busySessions, runningTerminals, reasons };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRestartReadinessReason(value: unknown): value is RestartReadinessReason {
  return value === "busy-sessions" || value === "running-terminals";
}

function arraysEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
