import { resolveAppUrl } from "../appUrl";

export function request<T>(url: string, parse: (value: unknown) => T, init?: RequestInit): Promise<T> {
  return requestInternal(url, parse, init);
}

/**
 * Parses one documented non-success response for an endpoint whose response
 * body is part of its protocol. All other HTTP failures retain request()'s
 * normal error behavior.
 */
export function requestWithAllowedErrorStatus<T>(url: string, parse: (value: unknown) => T, allowedErrorStatus: number, init?: RequestInit): Promise<T> {
  return requestInternal(url, parse, init, allowedErrorStatus);
}

async function requestInternal<T>(url: string, parse: (value: unknown) => T, init: RequestInit | undefined, allowedErrorStatus?: number): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(resolveAppUrl(url), { ...init, headers });
  if (!response.ok && response.status !== allowedErrorStatus) {
    const body: unknown = await response.json().catch((): unknown => ({}));
    throw new Error(errorMessage(body) ?? response.statusText);
  }
  const body: unknown = await response.json();
  return parse(body);
}

function errorMessage(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value["error"] === "string" ? value["error"] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
