import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { posix, win32 } from "node:path";

import { FrpcProcessManager, type FrpcLifecycleState } from "@jmfederico/pi-web-tunnel-frp-engine";

import { type ConnectorConfig, type ConnectorMachineCredentials } from "./config-storage.js";

export const connectorFrpcConfigFileName = "frpc.toml";
export const connectorPidFileName = "connector.pid";
export const connectorRuntimeFileMode = 0o600;
export const connectorRuntimeDirectoryMode = 0o700;

/**
 * Local runtime file locations derived from the connector config directory. The
 * frpc config file carries relay auth material, so it is written with the same
 * private mode as the connector config.
 */
export interface ConnectorRuntimePaths {
  readonly frpcConfigPath: string;
  readonly pidFilePath: string;
  readonly runtimeDirectory: string;
}

export interface MachineTunnelConfig {
  readonly machineId: string;
  readonly publicUrl: string;
  readonly localPiWebUrl: string;
  readonly frpcConfigToml: string;
}

export interface FetchLikeRequestInit {
  readonly body?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly method?: string;
}

export interface FetchLikeResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type FetchLike = (input: string, init?: FetchLikeRequestInit) => Promise<FetchLikeResponse>;

export interface FetchTunnelConfigDependencies {
  readonly credentials: ConnectorMachineCredentials;
  readonly fetch: FetchLike;
}

export interface ConnectorRuntimeDependencies {
  readonly chmod: (path: string, mode: number) => void;
  readonly mkdir: (path: string, mode: number) => void;
  readonly platform: NodeJS.Platform;
  readonly readFile: (path: string) => string;
  readonly removeFile: (path: string) => void;
  readonly writeFile: (path: string, contents: string, mode: number) => void;
}

export interface OutputSink {
  write(chunk: string): void;
}

export interface RunConnectorStartDependencies extends ConnectorRuntimeDependencies {
  readonly config: ConnectorConfig;
  readonly fetch: FetchLike;
  readonly frpcPathOverride?: string;
  readonly paths: ConnectorRuntimePaths;
  readonly pid: number;
  readonly processManager: FrpcProcessManager;
  readonly registerSignalHandler: (signal: NodeJS.Signals, handler: () => void) => void;
  readonly stdout: OutputSink;
}

export interface RunConnectorStopDependencies extends ConnectorRuntimeDependencies {
  readonly paths: ConnectorRuntimePaths;
  readonly signalProcess: (pid: number, signal: NodeJS.Signals) => void;
  readonly stdout: OutputSink;
}

export function createNodeConnectorRuntimeDependencies(
  platform: NodeJS.Platform = process.platform,
): ConnectorRuntimeDependencies {
  return {
    chmod(path, mode): void {
      chmodSync(path, mode);
    },
    mkdir(path, mode): void {
      mkdirSync(path, { mode, recursive: true });
    },
    platform,
    readFile(path): string {
      return readFileSync(path, "utf8");
    },
    removeFile(path): void {
      rmSync(path, { force: true });
    },
    writeFile(path, contents, mode): void {
      writeFileSync(path, contents, { encoding: "utf8", mode });
    },
  };
}

export function resolveConnectorRuntimePaths(
  configDirectory: string,
  platform: NodeJS.Platform,
): ConnectorRuntimePaths {
  const pathApi = platform === "win32" ? win32 : posix;

  return {
    frpcConfigPath: pathApi.join(configDirectory, connectorFrpcConfigFileName),
    pidFilePath: pathApi.join(configDirectory, connectorPidFileName),
    runtimeDirectory: configDirectory,
  };
}

/**
 * Fetch the per-machine frp tunnel-config from the running Control API using the
 * persisted machine token. Throws a descriptive error for non-OK responses or a
 * malformed body so the CLI can surface it.
 */
export async function fetchMachineTunnelConfig(
  dependencies: FetchTunnelConfigDependencies,
): Promise<MachineTunnelConfig> {
  const { credentials } = dependencies;
  const baseUrl = credentials.controlApiBaseUrl.replace(/\/+$/u, "");
  const url = `${baseUrl}/v1/machines/${encodeURIComponent(credentials.machineId)}/tunnel-config`;

  const response = await dependencies.fetch(url, {
    headers: {
      authorization: `Bearer ${credentials.machineToken}`,
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Control API tunnel-config request failed with status ${response.status.toString()}.`,
    );
  }

  return parseTunnelConfigResponse(await response.json());
}

/**
 * Foreground `start`: fetch tunnel-config, write the frp TOML and a PID file,
 * launch `frpc`, install SIGTERM/SIGINT handlers that stop `frpc`, and resolve
 * once `frpc` exits. Returns the process exit code.
 */
export async function runConnectorStart(
  dependencies: RunConnectorStartDependencies,
): Promise<number> {
  const credentials = requireMachineCredentials(dependencies.config);
  const frpcPath = resolveFrpcPath(dependencies);

  const tunnelConfig = applyLocalPiWebTarget(
    await fetchMachineTunnelConfig({
      credentials,
      fetch: dependencies.fetch,
    }),
    dependencies.config.localPiWebUrl,
  );

  ensureRuntimeDirectory(dependencies, dependencies.paths.runtimeDirectory);
  writeRuntimeFile(dependencies, dependencies.paths.frpcConfigPath, tunnelConfig.frpcConfigToml);
  writeRuntimeFile(dependencies, dependencies.paths.pidFilePath, `${dependencies.pid.toString()}\n`);

  writeLine(dependencies.stdout, "Starting PI WEB Safe Tunnel connector.");
  writeLine(dependencies.stdout, `Public URL: ${tunnelConfig.publicUrl}`);
  writeLine(dependencies.stdout, `Local target: ${tunnelConfig.localPiWebUrl}`);

  const launchState = dependencies.processManager.start({
    configPath: dependencies.paths.frpcConfigPath,
    frpcPath,
  });

  if (launchState.kind === "failed") {
    dependencies.removeFile(dependencies.paths.pidFilePath);
    throw new Error(`Failed to launch frpc: ${launchState.errorMessage}`);
  }

  const stopFrpc = (): void => {
    dependencies.processManager.stop();
  };

  dependencies.registerSignalHandler("SIGTERM", stopFrpc);
  dependencies.registerSignalHandler("SIGINT", stopFrpc);

  const exitState = await dependencies.processManager.waitForExit();

  dependencies.removeFile(dependencies.paths.pidFilePath);

  return reportFinalState(dependencies.stdout, exitState);
}

/**
 * `stop`: read the connector PID file and signal the running foreground
 * connector so its handler stops `frpc` gracefully.
 */
export function runConnectorStop(dependencies: RunConnectorStopDependencies): number {
  const pid = readPidFile(dependencies);

  if (pid === undefined) {
    writeLine(dependencies.stdout, "No running PI WEB Safe Tunnel connector was found.");
    return 0;
  }

  dependencies.signalProcess(pid, "SIGTERM");
  writeLine(dependencies.stdout, `Signalled connector process ${pid.toString()} to stop.`);
  return 0;
}

function reportFinalState(stdout: OutputSink, state: FrpcLifecycleState): number {
  if (state.kind === "exited" && (state.exitCode === 0 || state.exitCode === null)) {
    writeLine(stdout, "PI WEB Safe Tunnel connector stopped.");
    return 0;
  }

  if (state.kind === "failed") {
    writeLine(stdout, `PI WEB Safe Tunnel connector failed: ${state.errorMessage}`);
    return 1;
  }

  const exitCode = state.kind === "exited" ? state.exitCode : null;
  writeLine(stdout, `PI WEB Safe Tunnel connector exited with code ${exitCode?.toString() ?? "unknown"}.`);
  return 1;
}

function readPidFile(dependencies: RunConnectorStopDependencies): number | undefined {
  let contents: string;

  try {
    contents = dependencies.readFile(dependencies.paths.pidFilePath);
  } catch {
    return undefined;
  }

  const trimmed = contents.trim();

  if (!/^[1-9]\d*$/u.test(trimmed)) {
    throw new Error("Connector PID file is malformed.");
  }

  return Number.parseInt(trimmed, 10);
}

function requireMachineCredentials(config: ConnectorConfig): ConnectorMachineCredentials {
  if (config.machine === undefined) {
    throw new Error(
      "No machine credentials found. Run `pi-web-tunnel login` or `pi-web-tunnel register-machine` first.",
    );
  }

  return config.machine;
}

function resolveFrpcPath(dependencies: RunConnectorStartDependencies): string {
  const frpcPath = dependencies.frpcPathOverride ?? dependencies.config.frpcPath;

  if (frpcPath === undefined || frpcPath.trim().length === 0) {
    throw new Error(
      "No frpc executable path configured. Pass --frpc-path or set it via login/register-machine.",
    );
  }

  return frpcPath;
}

function ensureRuntimeDirectory(dependencies: ConnectorRuntimeDependencies, directory: string): void {
  dependencies.mkdir(directory, connectorRuntimeDirectoryMode);
  applyPrivateMode(dependencies, directory, connectorRuntimeDirectoryMode);
}

function writeRuntimeFile(
  dependencies: ConnectorRuntimeDependencies,
  path: string,
  contents: string,
): void {
  dependencies.writeFile(path, contents, connectorRuntimeFileMode);
  applyPrivateMode(dependencies, path, connectorRuntimeFileMode);
}

function applyPrivateMode(
  dependencies: ConnectorRuntimeDependencies,
  path: string,
  mode: number,
): void {
  if (dependencies.platform === "win32") {
    return;
  }

  dependencies.chmod(path, mode);
}

function applyLocalPiWebTarget(
  tunnelConfig: MachineTunnelConfig,
  localPiWebUrl: string,
): MachineTunnelConfig {
  const connectorTarget = normalizeLocalPiWebUrl(localPiWebUrl);
  const controlApiTarget = normalizeLocalPiWebUrl(tunnelConfig.localPiWebUrl);

  if (connectorTarget.url === controlApiTarget.url) {
    return tunnelConfig;
  }

  return {
    ...tunnelConfig,
    localPiWebUrl: connectorTarget.url,
    frpcConfigToml: replaceFrpcLocalTarget(
      tunnelConfig.frpcConfigToml,
      controlApiTarget,
      connectorTarget,
    ),
  };
}

interface LocalPiWebTarget {
  readonly localIP: string;
  readonly localPort: number;
  readonly url: string;
}

function normalizeLocalPiWebUrl(value: string): LocalPiWebTarget {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(value.trim());
  } catch {
    throw new Error("Connector config localPiWebUrl must be a valid URL.");
  }

  if (parsedUrl.protocol !== "http:") {
    throw new Error("Connector config localPiWebUrl must use http.");
  }

  if (parsedUrl.username !== "" || parsedUrl.password !== "") {
    throw new Error("Connector config localPiWebUrl must not include credentials.");
  }

  if (parsedUrl.pathname !== "/" || parsedUrl.search !== "" || parsedUrl.hash !== "") {
    throw new Error("Connector config localPiWebUrl must not include a path, query, or fragment.");
  }

  if (parsedUrl.port === "") {
    throw new Error("Connector config localPiWebUrl must include an explicit port.");
  }

  const localPort = Number.parseInt(parsedUrl.port, 10);
  if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65_535) {
    throw new Error("Connector config localPiWebUrl port must be between 1 and 65535.");
  }

  return {
    localIP: parsedUrl.hostname,
    localPort,
    url: parsedUrl.origin,
  };
}

function replaceFrpcLocalTarget(
  frpcConfigToml: string,
  from: LocalPiWebTarget,
  to: LocalPiWebTarget,
): string {
  return replaceTomlScalar(
    replaceTomlScalar(
      frpcConfigToml,
      "localIP",
      formatTomlString(from.localIP),
      formatTomlString(to.localIP),
    ),
    "localPort",
    from.localPort.toString(),
    to.localPort.toString(),
  );
}

function replaceTomlScalar(
  toml: string,
  key: string,
  oldValue: string,
  newValue: string,
): string {
  const pattern = new RegExp(`(^\\s*${escapeRegExp(key)}\\s*=\\s*)${escapeRegExp(oldValue)}(\\s*(?:\\r?\\n|$))`, "mu");
  if (!pattern.test(toml)) {
    throw new Error(`Control API tunnel-config response did not include ${key} = ${oldValue}.`);
  }

  return toml.replace(pattern, (_match, prefix: string, suffix: string) => `${prefix}${newValue}${suffix}`);
}

function formatTomlString(value: string): string {
  return JSON.stringify(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function parseTunnelConfigResponse(body: unknown): MachineTunnelConfig {
  if (!isRecord(body)) {
    throw new Error("Control API tunnel-config response must be a JSON object.");
  }

  const machine = body["machine"];
  const machineId = isRecord(machine) ? machine["id"] : undefined;
  const frp = body["frp"];
  const frpcConfigToml = isRecord(frp) ? frp["frpcConfigToml"] : undefined;

  return {
    machineId: requireResponseString(machineId, "machine.id"),
    publicUrl: requireResponseString(body["publicUrl"], "publicUrl"),
    localPiWebUrl: requireResponseString(body["localPiWebUrl"], "localPiWebUrl"),
    frpcConfigToml: requireResponseString(frpcConfigToml, "frp.frpcConfigToml"),
  };
}

function requireResponseString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Control API tunnel-config response ${fieldName} must be a non-empty string.`);
  }

  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeLine(sink: OutputSink, line: string): void {
  sink.write(`${line}\n`);
}
