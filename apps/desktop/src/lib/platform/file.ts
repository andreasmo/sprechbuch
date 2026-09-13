import type { PickedFile } from "./types";

export async function readBrowserFile(file: File): Promise<PickedFile> {
  return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
}
