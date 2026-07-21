import { makeError } from "@discstream/contracts";
import { LinuxPlatformAdapter } from "./linux/linux-adapter.js";
import { MacosPlatformAdapter } from "./macos/macos-adapter.js";
import type { PlatformAdapter, RuntimePaths } from "./platform-adapter.js";

export function createPlatformAdapter(paths: RuntimePaths): PlatformAdapter {
  if (process.platform === "linux") {
    return new LinuxPlatformAdapter(paths);
  }

  if (process.platform === "darwin") {
    return new MacosPlatformAdapter(paths);
  }

  throw makeError("UNSUPPORTED_PLATFORM", `DiscStream does not support ${process.platform}.`, {
    recoverable: false
  });
}
