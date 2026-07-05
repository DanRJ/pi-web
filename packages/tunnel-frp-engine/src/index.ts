export const frpEnginePackageName = "@jmfederico/pi-web-tunnel-frp-engine";

export {
  FrpcProcessManager,
  createFrpcSpawnRequest,
  createNodeFrpcProcessManagerDependencies,
  defaultFrpcStopSignal,
  frpcConfigFlag,
} from "./frpc-process.js";

export type {
  FrpcLaunchOptions,
  FrpcLifecycleState,
  FrpcProcessManagerDependencies,
  FrpcProcessSpawner,
  FrpcSpawnRequest,
  ManagedFrpcChildProcess,
} from "./frpc-process.js";
