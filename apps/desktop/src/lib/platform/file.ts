import { sha256Hex } from "@sprechbuch/core";
import type { PickedFile } from "./types";

/** Datei aus Drag & Drop oder Dateiauswahl lesen – mit Hash, damit dieselbe Fassung wiedererkannt wird. */
export async function readBrowserFile(file: File): Promise<PickedFile> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return { name: file.name, bytes, stamp: { size: bytes.length, modifiedMs: file.lastModified, sha256: await sha256Hex(bytes) } };
}
