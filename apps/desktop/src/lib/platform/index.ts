import { isTauri } from "@tauri-apps/api/core";
import type { Platform } from "./types";

export type { DesktopFiles, FileKind, FileStamp, PickedFile, Platform, SaveBookOptions } from "./types";
export { baseName, FileConflictError, FileMissingError, isAbsolutePath, siblingPath } from "./types";
export { readBrowserFile } from "./file";

/** Die passende Plattform – das Tauri-Modul wird nur auf dem Desktop geladen. */
export async function detectPlatform(): Promise<Platform> {
  if (isTauri()) return (await import("./tauri")).tauriPlatform;
  return (await import("./web")).webPlatform;
}
