import { afterEach, describe, expect, it, vi } from "vitest";
import { safeTunnelApi, type SafeTunnelOperationResponse, type SafeTunnelStatusResponse } from "../../api";
import { createSafeTunnelLoginRequest, machineSlugFromName, safeTunnelLoginValidationMessage, SettingsSafeTunnelPanel } from "./SettingsSafeTunnelPanel";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Safe Tunnel login form helpers", () => {
  it("validates the login fields before calling the bridge", () => {
    expect(safeTunnelLoginValidationMessage({ controlApiUrl: "", machineName: "Dev Box", machineSlug: "dev-box", localPiWebUrl: "", frpcPath: "" })).toBe("Control API URL is required.");
    expect(safeTunnelLoginValidationMessage({ controlApiUrl: "ftp://control.example.test", machineName: "Dev Box", machineSlug: "dev-box", localPiWebUrl: "", frpcPath: "" })).toBe("Control API URL must use http:// or https://.");
    expect(safeTunnelLoginValidationMessage({ controlApiUrl: "https://control.example.test", machineName: "Dev Box", machineSlug: "Dev Box", localPiWebUrl: "", frpcPath: "" })).toBe("Machine slug must be a lowercase DNS label (letters, numbers, hyphens; no leading or trailing hyphen).");
    expect(safeTunnelLoginValidationMessage({ controlApiUrl: "https://control.example.test", machineName: "Dev Box", machineSlug: "dev-box", localPiWebUrl: "http://127.0.0.1:8504", frpcPath: "" })).toBeUndefined();
  });

  it("normalizes login requests and machine slugs", () => {
    expect(machineSlugFromName(" Federico's Dev Box! ")).toBe("federico-s-dev-box");
    expect(createSafeTunnelLoginRequest({
      controlApiUrl: " https://control.example.test ",
      machineName: " Dev Box ",
      machineSlug: " dev-box ",
      localPiWebUrl: " http://127.0.0.1:8504 ",
      frpcPath: " ",
    })).toEqual({
      controlApiUrl: "https://control.example.test",
      machineName: "Dev Box",
      machineSlug: "dev-box",
      localPiWebUrl: "http://127.0.0.1:8504",
    });
  });
});

describe("settings-safe-tunnel-panel operations", () => {
  it("loads status and adopts an active operation", async () => {
    const operation = safeTunnelOperation({ status: "running" });
    const status = safeTunnelStatus({ activeOperation: operation });
    vi.spyOn(safeTunnelApi, "status").mockResolvedValue(status);
    const panel = new SettingsSafeTunnelPanel();

    await callPanelPromise(panel, "loadStatus");

    expect(getPanelProperty(panel, "status")).toBe(status);
    expect(getPanelProperty(panel, "operation")).toBe(operation);
    expect(getPanelProperty(panel, "controlApiUrl")).toBe("https://control.example.test");
    expect(getPanelProperty(panel, "localPiWebUrl")).toBe("http://127.0.0.1:8504");
    expect(getPanelProperty(panel, "loading")).toBe(false);
  });

  it("starts login through the Safe Tunnel bridge", async () => {
    const operation = safeTunnelOperation({ status: "running" });
    const status = safeTunnelStatus({ activeOperation: operation });
    const loginSpy = vi.spyOn(safeTunnelApi, "login").mockResolvedValue({ operation, status });
    const panel = new SettingsSafeTunnelPanel();
    setPanelProperty(panel, "controlApiUrl", " https://control.example.test ");
    setPanelProperty(panel, "machineName", " Dev Box ");
    setPanelProperty(panel, "machineSlug", " dev-box ");
    setPanelProperty(panel, "localPiWebUrl", " http://127.0.0.1:8504 ");
    setPanelProperty(panel, "loginFrpcPath", " /opt/frpc ");

    await callPanelPromise(panel, "startLogin");

    expect(loginSpy).toHaveBeenCalledWith({
      controlApiUrl: "https://control.example.test",
      machineName: "Dev Box",
      machineSlug: "dev-box",
      localPiWebUrl: "http://127.0.0.1:8504",
      frpcPath: "/opt/frpc",
    });
    expect(getPanelProperty(panel, "operation")).toBe(operation);
    expect(getPanelProperty(panel, "status")).toBe(status);
    expect(getPanelProperty(panel, "message")).toBe("Safe Tunnel login started. Approve the connector in the hosted page.");
    expect(getPanelProperty(panel, "mutating")).toBe(false);
  });

  it("starts and stops the connector through the bridge", async () => {
    const stopped = safeTunnelStatus({ runtimeState: "stopped", frpcPathConfigured: true });
    const running = safeTunnelStatus({ runtimeState: "running", frpcPathConfigured: true });
    const startSpy = vi.spyOn(safeTunnelApi, "start").mockResolvedValue({ accepted: true, connectorProcessId: 1234, status: running });
    const stopSpy = vi.spyOn(safeTunnelApi, "stop").mockResolvedValue({ command: { exitCode: 0, stdout: "Stopped\n", stderr: "" }, status: stopped });
    const panel = new SettingsSafeTunnelPanel();
    setPanelProperty(panel, "status", stopped);

    await callPanelPromise(panel, "startConnector");

    expect(startSpy).toHaveBeenCalledWith({});
    expect(getPanelProperty(panel, "status")).toBe(running);
    expect(getPanelProperty(panel, "message")).toBe("Safe Tunnel connector start requested (PID 1234).");

    await callPanelPromise(panel, "stopConnector");

    expect(stopSpy).toHaveBeenCalledWith();
    expect(getPanelProperty(panel, "status")).toBe(stopped);
    expect(getPanelProperty(panel, "message")).toBe("Safe Tunnel connector stopped.");
  });

  it("polls an operation and keeps the public URL visible after success", async () => {
    const operation = safeTunnelOperation({ status: "succeeded", publicUrl: "https://dev-box.ns.tunnels.pi-web.dev" });
    const status = safeTunnelStatus({ runtimeState: "stopped" });
    vi.spyOn(safeTunnelApi, "operation").mockResolvedValue(operation);
    vi.spyOn(safeTunnelApi, "status").mockResolvedValue(status);
    const panel = new SettingsSafeTunnelPanel();

    await callPanelPromise(panel, "pollOperation", "op_1");

    expect(getPanelProperty(panel, "operation")).toBe(operation);
    expect(getPanelProperty(panel, "status")).toBe(status);
    expect(getPanelProperty(panel, "message")).toBe("Safe Tunnel login completed. Public URL is ready.");
  });
});

interface SafeTunnelStatusOptions {
  activeOperation?: SafeTunnelOperationResponse;
  frpcPathConfigured?: boolean;
  runtimeState?: SafeTunnelStatusResponse["runtime"]["state"];
}

function safeTunnelStatus(options: SafeTunnelStatusOptions = {}): SafeTunnelStatusResponse {
  return {
    connector: { command: "pi-web-tunnel", state: "available" },
    config: {
      path: "/home/test/.config/pi-web-tunnel/config.json",
      exists: true,
      state: "registered",
      localPiWebUrl: "http://127.0.0.1:8504",
      frpcPathConfigured: options.frpcPathConfigured ?? true,
      machine: { controlApiBaseUrl: "https://control.example.test", machineId: "machine_1" },
    },
    runtime: {
      pidFilePath: "/home/test/.config/pi-web-tunnel/connector.pid",
      state: options.runtimeState ?? "running",
      ...(options.runtimeState === "running" || options.runtimeState === undefined ? { pid: 1234 } : {}),
    },
    ...(options.activeOperation === undefined ? {} : { activeOperation: options.activeOperation }),
  };
}

function safeTunnelOperation(options: { publicUrl?: string; status: SafeTunnelOperationResponse["status"] }): SafeTunnelOperationResponse {
  return {
    id: "op_1",
    kind: "login",
    status: options.status,
    startedAt: "2026-07-03T00:00:00.000Z",
    stdout: "Open this URL to authorize the connector:\nhttps://control.example.test/device?userCode=ABCD-EFGH\nUser code: ABCD-EFGH\n",
    stderr: "",
    userCode: "ABCD-EFGH",
    verificationUriComplete: "https://control.example.test/device?userCode=ABCD-EFGH",
    ...(options.publicUrl === undefined ? {} : { publicUrl: options.publicUrl }),
  };
}

async function callPanelPromise(panel: SettingsSafeTunnelPanel, methodName: string, ...args: readonly unknown[]): Promise<void> {
  const result = callPanelMethod(panel, methodName, ...args);
  if (!(result instanceof Promise)) throw new Error(`SettingsSafeTunnelPanel.${methodName} did not return a promise`);
  await result;
}

function callPanelMethod(panel: SettingsSafeTunnelPanel, methodName: string, ...args: readonly unknown[]): unknown {
  const method: unknown = Reflect.get(panel, methodName);
  if (!isPanelMethod(method)) throw new Error(`SettingsSafeTunnelPanel.${methodName} is not callable`);
  return method.call(panel, ...args);
}

function isPanelMethod(value: unknown): value is (this: SettingsSafeTunnelPanel, ...args: readonly unknown[]) => unknown {
  return typeof value === "function";
}

function setPanelProperty(panel: SettingsSafeTunnelPanel, property: string, value: unknown): void {
  Reflect.set(panel, property, value);
}

function getPanelProperty(panel: SettingsSafeTunnelPanel, property: string): unknown {
  return Reflect.get(panel, property);
}
