import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { ACCEPT, type FileKind, type Platform } from "./types";

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

export const tauriPlatform: Platform = {
  kind: "tauri",
  canOverwrite: true,

  async pickFile(kind: FileKind) {
    const path = await open({
      multiple: false,
      directory: false,
      filters: [{ name: ACCEPT[kind].label, extensions: ACCEPT[kind].extensions }],
    });
    if (typeof path !== "string") return null;
    return { name: baseName(path), path, bytes: await readFile(path) };
  },

  async saveFile(bytes, suggestedName, kind, path) {
    const target = path ?? (await save({
      defaultPath: suggestedName,
      filters: [{ name: ACCEPT[kind].label, extensions: ACCEPT[kind].extensions }],
    }));
    if (!target) return null;
    // TODO(Phase 3): atomar schreiben (temporäre Datei + Umbenennen) und Fremdänderungen erkennen
    await writeFile(target, bytes);
    return target;
  },
};
