import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import {
  FrpcProcessManager,
  type ManagedFrpcChildProcess,
} from "@jmfederico/pi-web-tunnel-frp-engine";

import { type ConnectorConfig } from "./config-storage.js";
import {
  type ConnectorRuntimeDependencies,
  type ConnectorRuntimePaths,
  type FetchLike,
  type OutputSink,
  fetchMachineTunnelConfig,
  resolveConnectorRuntimePaths,
  runConnectorStart,
  runConnectorStop,
} from "./connector-runtime.js";

class FakeFrpcChildProcess extends EventEmitter implements ManagedFrpcChildProcess {
  public readonly pid = 4242;
  public lastSignal: NodeJS.Signals | undefined;

  public kill(signal: NodeJS.Signals): boolean {
    this.lastSignal = signal;
    queueMicrotask(() => {
      this.emit("exit", null, signal);
    });
    return true;
  }
}

const exampleCredentials = {
  controlApiBaseUrl: "http://127.0.0.1:8787",
  machineId: "machine_abc",
  machineToken: "piwt_mtok_v1_secret",
} as const;

interface CapturedSink {
  readonly output: () => string;
  readonly sink: OutputSink;
}

function createCapturedSink(): CapturedSink {
  let output = "";
  return {
    output: () => output,
    sink: {
      write(chunk): void {
        output = `${output}${chunk}`;
      },
    },
  };
}

interface FakeRuntime {
  readonly dependencies: ConnectorRuntimeDependencies;
  readonly writes: () => { path: string; contents: string }[];
  readonly removed: () => string[];
  readonly files: Map<string, string>;
}

function createFakeRuntime(): FakeRuntime {
  const writes: { path: string; contents: string }[] = [];
  const removed: string[] = [];
  const files = new Map<string, string>();

  return {
    files,
    removed: () => removed,
    writes: () => writes,
    dependencies: {
      chmod: () => undefined,
      mkdir: () => undefined,
      platform: "linux",
      readFile: (path) => {
        const contents = files.get(path);
        if (contents === undefined) {
          throw new Error(`ENOENT: ${path}`);
        }
        return contents;
      },
      removeFile: (path) => {
        removed.push(path);
        files.delete(path);
      },
      writeFile: (path, contents) => {
        writes.push({ path, contents });
        files.set(path, contents);
      },
    },
  };
}

const paths: ConnectorRuntimePaths = resolveConnectorRuntimePaths(
  "/home/pi/.config/pi-web-tunnel",
  "linux",
);

function createConfig(): ConnectorConfig {
  return {
    localPiWebUrl: "http://127.0.0.1:8504",
    schemaVersion: 2,
    frpcPath: "/usr/local/bin/frpc",
    machine: {
      controlApiBaseUrl: "http://127.0.0.1:8787",
      machineId: "machine_abc",
      machineToken: "piwt_mtok_v1_secret",
    },
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("waitFor predicate never became true");
}

function createTunnelConfigFetch(): FetchLike {
  return (input) => {
    if (input !== "http://127.0.0.1:8787/v1/machines/machine_abc/tunnel-config") {
      return Promise.reject(new Error(`unexpected url: ${input}`));
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          machine: { id: "machine_abc" },
          publicHostname: "my-dev-box.ns.tunnels.pi-web.dev",
          publicUrl: "https://my-dev-box.ns.tunnels.pi-web.dev",
          localPiWebUrl: "http://127.0.0.1:8504",
          frp: { proxyName: "p", configFormat: "toml", frpcConfigToml: "[[proxies]]\n" },
        }),
    });
  };
}

describe("fetchMachineTunnelConfig", () => {
  it("requests tunnel-config with the bearer machine token and parses the body", async () => {
    let observedHeaders: Readonly<Record<string, string>> | undefined;

    const result = await fetchMachineTunnelConfig({
      credentials: exampleCredentials,
      fetch: (_input, init) => {
        observedHeaders = init?.headers;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              machine: { id: "machine_abc" },
              publicHostname: "h",
              publicUrl: "https://h",
              localPiWebUrl: "http://127.0.0.1:8504",
              frp: { frpcConfigToml: "toml" },
            }),
        });
      },
    });

    expect(observedHeaders?.["authorization"]).toBe("Bearer piwt_mtok_v1_secret");
    expect(result.frpcConfigToml).toBe("toml");
    expect(result.publicUrl).toBe("https://h");
  });

  it("throws on a non-OK response", async () => {
    await expect(
      fetchMachineTunnelConfig({
        credentials: exampleCredentials,
        fetch: () => Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) }),
      }),
    ).rejects.toThrow("status 401");
  });

  it("throws on a malformed body", async () => {
    await expect(
      fetchMachineTunnelConfig({
        credentials: exampleCredentials,
        fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }),
      }),
    ).rejects.toThrow("must be a non-empty string");
  });
});

describe("runConnectorStart", () => {
  it("fetches config, writes runtime files, launches frpc, and stops on signal", async () => {
    const runtime = createFakeRuntime();
    const child = new FakeFrpcChildProcess();
    const manager = new FrpcProcessManager({
      spawnFrpc: (): ManagedFrpcChildProcess => child,
    });
    const stdout = createCapturedSink();
    const signalHandlers = new Map<NodeJS.Signals, () => void>();

    const startPromise = runConnectorStart({
      ...runtime.dependencies,
      config: createConfig(),
      fetch: createTunnelConfigFetch(),
      paths,
      pid: 7777,
      processManager: manager,
      registerSignalHandler: (signal, handler) => {
        signalHandlers.set(signal, handler);
      },
      stdout: stdout.sink,
    });

    // Wait until start has launched frpc and registered its signal handlers,
    // then simulate the OS delivering SIGTERM to the foreground connector.
    await waitFor(() => signalHandlers.has("SIGTERM"));
    signalHandlers.get("SIGTERM")?.();

    const exitCode = await startPromise;

    expect(exitCode).toBe(0);
    expect(child.lastSignal).toBe("SIGTERM");
    expect(runtime.writes().map((write) => write.path)).toEqual([
      paths.frpcConfigPath,
      paths.pidFilePath,
    ]);
    expect(runtime.files.get(paths.frpcConfigPath)).toBe("[[proxies]]\n");
    expect(runtime.removed()).toContain(paths.pidFilePath);
    expect(stdout.output()).toContain("Public URL: https://my-dev-box.ns.tunnels.pi-web.dev\n");
  });

  it("throws when no machine credentials are present", async () => {
    const runtime = createFakeRuntime();

    await expect(
      runConnectorStart({
        ...runtime.dependencies,
        config: { localPiWebUrl: "http://127.0.0.1:8504", schemaVersion: 2 },
        fetch: createTunnelConfigFetch(),
        paths,
        pid: 1,
        processManager: new FrpcProcessManager({ spawnFrpc: () => new FakeFrpcChildProcess() }),
        registerSignalHandler: () => undefined,
        stdout: createCapturedSink().sink,
      }),
    ).rejects.toThrow("register-machine");
  });

  it("throws when no frpc path is resolvable", async () => {
    const runtime = createFakeRuntime();

    await expect(
      runConnectorStart({
        ...runtime.dependencies,
        config: {
          localPiWebUrl: "http://127.0.0.1:8504",
          schemaVersion: 2,
          machine: {
            controlApiBaseUrl: "http://127.0.0.1:8787",
            machineId: "machine_abc",
            machineToken: "piwt_mtok_v1_secret",
          },
        },
        fetch: createTunnelConfigFetch(),
        paths,
        pid: 1,
        processManager: new FrpcProcessManager({ spawnFrpc: () => new FakeFrpcChildProcess() }),
        registerSignalHandler: () => undefined,
        stdout: createCapturedSink().sink,
      }),
    ).rejects.toThrow("frpc executable path");
  });
});

describe("runConnectorStop", () => {
  it("signals the recorded PID", () => {
    const runtime = createFakeRuntime();
    runtime.files.set(paths.pidFilePath, "9988\n");
    const signals: { pid: number; signal: NodeJS.Signals }[] = [];
    const stdout = createCapturedSink();

    const exitCode = runConnectorStop({
      ...runtime.dependencies,
      paths,
      signalProcess: (pid, signal) => {
        signals.push({ pid, signal });
      },
      stdout: stdout.sink,
    });

    expect(exitCode).toBe(0);
    expect(signals).toEqual([{ pid: 9988, signal: "SIGTERM" }]);
  });

  it("reports no running connector when the PID file is absent", () => {
    const runtime = createFakeRuntime();
    const signals: { pid: number; signal: NodeJS.Signals }[] = [];
    const stdout = createCapturedSink();

    const exitCode = runConnectorStop({
      ...runtime.dependencies,
      paths,
      signalProcess: (pid, signal) => {
        signals.push({ pid, signal });
      },
      stdout: stdout.sink,
    });

    expect(exitCode).toBe(0);
    expect(signals).toEqual([]);
    expect(stdout.output()).toContain("No running PI WEB Safe Tunnel connector was found.");
  });

  it("throws on a malformed PID file", () => {
    const runtime = createFakeRuntime();
    runtime.files.set(paths.pidFilePath, "not-a-pid");
    const stdout = createCapturedSink();

    expect(() =>
      runConnectorStop({
        ...runtime.dependencies,
        paths,
        signalProcess: () => undefined,
        stdout: stdout.sink,
      }),
    ).toThrow("malformed");
  });
});
