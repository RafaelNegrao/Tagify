import { invoke } from "@tauri-apps/api/core";

export interface UpdateInfo {
  available: boolean;
  current: string;
  version: string;
  url: string;
}

/** Current app version, from package.json (injected at build time). */
export const APP_VERSION = __APP_VERSION__;

export async function checkUpdate(): Promise<UpdateInfo> {
  return invoke<UpdateInfo>("check_update", { current: APP_VERSION });
}

/** Downloads the new exe and relaunches; the current app exits. */
export async function runUpdate(version: string, url: string): Promise<void> {
  return invoke("run_update", { version, url });
}
