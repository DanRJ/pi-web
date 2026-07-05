import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import {
  FrpcProcessManager,
  type FrpcProcessManagerDependencies,
  type FrpcSpawnRequest,
  type ManagedFrpcChildProcess,
  createFrpcSpawnRequest,
} from "./frpc-process.js";

interface FakeChildProcessOptions {
  readonly killResult?: boolean;
  readonly pid?: number;
}

interface FakeFrpcSpawner {
  readonly calls: () => readonly FrpcSpawnRequest[];
  readonly childProcess: FakeFrpcChildProcess;
  readonly dependencies: FrpcProcessManagerDependencies;
}

class FakeFrpcChildProcess extends EventEmitter implements ManagedFrpcChildProcess {
  public readonly pid?: number | undefined;

  private readonly killResult: boolean;
  private lastSignal: NodeJS.Signals | undefined;

  public constructor(options: FakeChildProcessOptions = {}) {
    super();
    this.killResult = options.killResult ?? true;
    this.pid = options.pid ?? 42;
  }

  public kill(signal: NodeJS.Signals): boolean {
    this.lastSignal = signal;
    return this.killResult;
  }

  public observedSignal(): NodeJS.Signals | undefined {
    return this.lastSignal;
  }

  public emitExit(exitCode: number | null, signal: NodeJS.Signals | null): void {
    this.emit("exit", exitCode, signal);
  }

  public emitSpawnError(error: Error): void {
    this.emit("error", error);
  }
}

function createFakeSpawner(childProcess: FakeFrpcChildProcess = new FakeFrpcChildProcess()): FakeFrpcSpawner {
  const calls: FrpcSpawnRequest[] = [];

  return {
    calls: () => calls,
    childProcess,
    dependencies: {
      spawnFrpc(request): ManagedFrpcChildProcess {
        calls.push(request);
        return childProcess;
      },
    },
  };
}

function createThrowingDependencies(error: unknown): FrpcProcessManagerDependencies {
  return {
    spawnFrpc(): ManagedFrpcChildProcess {
      throw error;
    },
  };
}

describe("frpc spawn request", () => {
  it("builds the frpc config-file arguments from explicit paths", () => {
    expect(createFrpcSpawnRequest({
      configPath: "/tmp/pi-web-tunnels/frpc.toml",
      frpcPath: "/opt/frp/frpc",
    })).toEqual({
      args: ["-c", "/tmp/pi-web-tunnels/frpc.toml"],
      frpcPath: "/opt/frp/frpc",
    });
  });

  it("carries optional process cwd and environment without inventing hosted API state", () => {
    expect(createFrpcSpawnRequest({
      configPath: "/tmp/pi-web-tunnels/frpc.toml",
      cwd: "/tmp/pi-web-tunnels",
      env: { FRPC_LOG_LEVEL: "debug" },
      frpcPath: "/opt/frp/frpc",
    })).toEqual({
      args: ["-c", "/tmp/pi-web-tunnels/frpc.toml"],
      cwd: "/tmp/pi-web-tunnels",
      env: { FRPC_LOG_LEVEL: "debug" },
      frpcPath: "/opt/frp/frpc",
    });
  });

  it("rejects blank executable and config paths", () => {
    expect(() => createFrpcSpawnRequest({ configPath: " ", frpcPath: "/opt/frp/frpc" })).toThrow(
      "configPath must be a non-empty string.",
    );
    expect(() => createFrpcSpawnRequest({ configPath: "/tmp/frpc.toml", frpcPath: "" })).toThrow(
      "frpcPath must be a non-empty string.",
    );
  });
});

describe("FrpcProcessManager", () => {
  it("launches frpc and reports the running lifecycle state", () => {
    const spawner = createFakeSpawner();
    const manager = new FrpcProcessManager(spawner.dependencies);

    expect(manager.start({ configPath: "/tmp/frpc.toml", frpcPath: "/opt/frp/frpc" })).toEqual({
      kind: "running",
      pid: 42,
    });
    expect(manager.getState()).toEqual({
      kind: "running",
      pid: 42,
    });
    expect(spawner.calls()).toEqual([
      {
        args: ["-c", "/tmp/frpc.toml"],
        frpcPath: "/opt/frp/frpc",
      },
    ]);
  });

  it("prevents multiple concurrent connector-managed frpc processes", () => {
    const spawner = createFakeSpawner();
    const manager = new FrpcProcessManager(spawner.dependencies);

    manager.start({ configPath: "/tmp/frpc.toml", frpcPath: "/opt/frp/frpc" });

    expect(() => manager.start({ configPath: "/tmp/other-frpc.toml", frpcPath: "/opt/frp/frpc" })).toThrow(
      "frpc is already running.",
    );
  });

  it("records process exits and clears the active process", () => {
    const spawner = createFakeSpawner();
    const manager = new FrpcProcessManager(spawner.dependencies);

    manager.start({ configPath: "/tmp/frpc.toml", frpcPath: "/opt/frp/frpc" });
    spawner.childProcess.emitExit(0, null);

    expect(manager.getState()).toEqual({
      exitCode: 0,
      kind: "exited",
      pid: 42,
      signal: null,
    });
    expect(manager.start({ configPath: "/tmp/frpc.toml", frpcPath: "/opt/frp/frpc" })).toEqual({
      kind: "running",
      pid: 42,
    });
  });

  it("signals the active frpc process when stopping", () => {
    const spawner = createFakeSpawner();
    const manager = new FrpcProcessManager(spawner.dependencies);

    manager.start({ configPath: "/tmp/frpc.toml", frpcPath: "/opt/frp/frpc" });

    expect(manager.stop("SIGINT")).toEqual({
      kind: "stopping",
      pid: 42,
      requestedSignal: "SIGINT",
    });
    expect(spawner.childProcess.observedSignal()).toBe("SIGINT");

    spawner.childProcess.emitExit(null, "SIGINT");

    expect(manager.getState()).toEqual({
      exitCode: null,
      kind: "exited",
      pid: 42,
      signal: "SIGINT",
    });
  });

  it("returns the current lifecycle state when no process is active during stop", () => {
    const manager = new FrpcProcessManager(createFakeSpawner().dependencies);

    expect(manager.stop()).toEqual({ kind: "idle" });
  });

  it("reports emitted frpc spawn errors as failed lifecycle state", () => {
    const spawner = createFakeSpawner();
    const manager = new FrpcProcessManager(spawner.dependencies);

    manager.start({ configPath: "/tmp/frpc.toml", frpcPath: "/opt/frp/frpc" });
    spawner.childProcess.emitSpawnError(new Error("spawn /opt/frp/frpc ENOENT"));

    expect(manager.getState()).toEqual({
      errorMessage: "spawn /opt/frp/frpc ENOENT",
      kind: "failed",
      pid: 42,
    });
  });

  it("reports synchronous process launch failures as failed lifecycle state", () => {
    const manager = new FrpcProcessManager(createThrowingDependencies(new Error("invalid cwd")));

    expect(manager.start({ configPath: "/tmp/frpc.toml", frpcPath: "/opt/frp/frpc" })).toEqual({
      errorMessage: "invalid cwd",
      kind: "failed",
      pid: null,
    });
  });

  it("reports failed stop signals as failed lifecycle state", () => {
    const spawner = createFakeSpawner(new FakeFrpcChildProcess({ killResult: false }));
    const manager = new FrpcProcessManager(spawner.dependencies);

    manager.start({ configPath: "/tmp/frpc.toml", frpcPath: "/opt/frp/frpc" });

    expect(manager.stop()).toEqual({
      errorMessage: "Failed to signal frpc process with SIGTERM.",
      kind: "failed",
      pid: 42,
    });
  });

  it("resolves waitForExit immediately when no process is active", async () => {
    const manager = new FrpcProcessManager(createFakeSpawner().dependencies);

    await expect(manager.waitForExit()).resolves.toEqual({ kind: "idle" });
  });

  it("resolves waitForExit with the exited state when frpc stops", async () => {
    const spawner = createFakeSpawner();
    const manager = new FrpcProcessManager(spawner.dependencies);

    manager.start({ configPath: "/tmp/frpc.toml", frpcPath: "/opt/frp/frpc" });
    const exited = manager.waitForExit();
    spawner.childProcess.emitExit(0, null);

    await expect(exited).resolves.toEqual({
      exitCode: 0,
      kind: "exited",
      pid: 42,
      signal: null,
    });
  });

  it("resolves waitForExit with the failed state when frpc errors", async () => {
    const spawner = createFakeSpawner();
    const manager = new FrpcProcessManager(spawner.dependencies);

    manager.start({ configPath: "/tmp/frpc.toml", frpcPath: "/opt/frp/frpc" });
    const exited = manager.waitForExit();
    spawner.childProcess.emitSpawnError(new Error("spawn /opt/frp/frpc ENOENT"));

    await expect(exited).resolves.toEqual({
      errorMessage: "spawn /opt/frp/frpc ENOENT",
      kind: "failed",
      pid: 42,
    });
  });
});
