/**
 * PI WEB's session-scoped browser protocol for Pi extension UI primitives.
 * These are intentionally not Pi RPC wire types: the SDK is embedded directly.
 */
export type ExtensionUiRequestState = "pending" | "submitted" | "cancelled" | "expired";

export interface ExtensionUiRequestBase {
  id: string;
  title: string;
  state: "pending";
}

export type ExtensionUiRequest =
  | (ExtensionUiRequestBase & { method: "select"; options: string[]; timeout?: number })
  | (ExtensionUiRequestBase & { method: "confirm"; message: string; timeout?: number })
  | (ExtensionUiRequestBase & { method: "input"; placeholder?: string; timeout?: number })
  | (ExtensionUiRequestBase & { method: "editor"; prefill?: string });

export interface ExtensionUiNotification {
  id: string;
  method: "notify";
  message: string;
  notifyType: "info" | "warning" | "error";
}

export type ExtensionUiResponse =
  | { id: string; value: string }
  | { id: string; confirmed: boolean }
  | { id: string; cancelled: true };

export interface ExtensionUiResolution {
  id: string;
  state: Exclude<ExtensionUiRequestState, "pending">;
  response?: ExtensionUiResponse;
  reason?: "timeout" | "session-ended" | "runtime-replaced";
}

export type ExtensionUiResponseOutcome = "accepted" | "already-resolved" | "invalid-response" | "not-found" | "wrong-session";

export interface ExtensionUiRespondResponse {
  outcome: ExtensionUiResponseOutcome;
  resolution?: ExtensionUiResolution;
}

export interface ExtensionUiPendingResponse {
  requests: ExtensionUiRequest[];
}
