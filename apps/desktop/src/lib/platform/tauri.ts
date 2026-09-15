import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { message, open, save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import {
  ACCEPT, baseName, FileConflictError, FileMissingError, type AiBridge, type AiKeyStatus, type DesktopFiles, type FileKind, type FileStamp, type Platform,
} from "./types";

const aiMessage = (err: unknown) =>
  err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : String(err);

/** Schlüssel im OS-Tresor; Anfragen laufen über Rust (`src-tauri/src/ai.rs`), das den Schlüssel anhängt */
const ai: AiBridge = {
  keyStorage: "os",
  async keyStatus(provider) {
    return invoke<AiKeyStatus | null>("ai_key_status", { provider });
  },
  async setKey(provider, baseUrl, key) {
    try {
      await invoke("ai_key_set", { provider, baseUrl, key });
    } catch (err) {
      throw new Error(aiMessage(err));
    }
  },
  async deleteKey(provider) {
    await invoke("ai_key_delete", { provider });
  },
  async allowCloud() {
    return (await invoke<{ allowCloud: boolean }>("ai_policy")).allowCloud;
  },
  async setAllowCloud(allow) {
    return (await invoke<{ allowCloud: boolean }>("ai_policy_set", { allowCloud: allow })).allowCloud;
  },
  async transport(req, signal) {
    const id = crypto.randomUUID();
    const cancel = () => void invoke("ai_http_cancel", { id });
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      return await invoke<{ status: number; body: string; retryAfter?: number }>("ai_http", { request: { ...req, id } });
    } catch (err) {
      const kind = err && typeof err === "object" && "kind" in err ? (err as { kind: string }).kind : "";
      // Fehlender Schlüssel oder gesperrte Adresse sind endgültig – als Antwort melden, damit nicht wiederholt wird
      if (kind === "noKey") return { status: 401, body: JSON.stringify({ error: { message: aiMessage(err) } }) };
      if (kind === "forbidden" || kind === "policy") return { status: 403, body: JSON.stringify({ error: { message: aiMessage(err) } }) };
      throw new Error(aiMessage(err));
    } finally {
      signal?.removeEventListener("abort", cancel);
    }
  },
};

/** Fehler aus den Rust-Befehlen (`src-tauri/src/files.rs`) in Klassen übersetzen */
function fileError(err: unknown): Error {
  if (err && typeof err === "object" && "kind" in err) {
    const e = err as { kind: string; message?: string; current?: FileStamp };
    if (e.kind === "conflict" && e.current) return new FileConflictError(e.current);
    if (e.kind === "notFound") return new FileMissingError(e.message);
    return new Error(e.message ?? e.kind);
  }
  return err instanceof Error ? err : new Error(String(err));
}

const files: DesktopFiles = {
  async read(path) {
    let buf: ArrayBuffer;
    try {
      buf = await invoke<ArrayBuffer>("book_file_read", { path });
    } catch (err) {
      throw fileError(err);
    }
    // Antwort: 4 Byte Länge + Stempel (JSON) + Inhalt
    const len = new DataView(buf).getUint32(0, true);
    const stamp = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len))) as FileStamp;
    return { name: baseName(path), path, bytes: new Uint8Array(buf, 4 + len), stamp };
  },

  async stamp(path, hash) {
    try {
      return await invoke<FileStamp | null>("book_file_stamp", { path, hash });
    } catch (err) {
      throw fileError(err);
    }
  },

  async saveBook(bytes, opts) {
    let target = opts.path;
    let force = opts.force ?? false;
    if (!target) {
      const chosen = await save({ defaultPath: opts.suggestedPath, filters: [{ name: ACCEPT.hbook.label, extensions: ["hbook"] }] });
      if (!chosen) return null;
      // Überschreiben hat der Dialog bereits bestätigt
      target = /\.hbook$/i.test(chosen) ? chosen : `${chosen}.hbook`;
      force = true;
    }
    try {
      const stamp = await invoke<FileStamp>("book_file_write", bytes, {
        headers: { "x-path": encodeURIComponent(target), "x-expected": opts.expected ?? "", "x-force": force ? "1" : "0" },
      });
      return { path: target, stamp };
    } catch (err) {
      throw fileError(err);
    }
  },

  async onOpenFiles(handler) {
    const take = async () => {
      const paths = await invoke<string[]>("take_opened_files");
      if (paths.length) handler(paths);
    };
    const unlisten = await listen("open-files", () => void take());
    await take();
    return unlisten;
  },

  onDragDrop({ over, drop }) {
    return getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (payload.type === "enter" || payload.type === "over") over(true);
      else if (payload.type === "leave") over(false);
      else {
        over(false);
        if (payload.paths.length) drop(payload.paths);
      }
    });
  },

  onCloseRequested(handler) {
    return getCurrentWindow().onCloseRequested(async (event) => {
      if (!(await handler())) event.preventDefault();
    });
  },

  async ask(text, buttons, title) {
    const res = await message(text, { title: title ?? "Sprechbuch", kind: "warning", buttons });
    return res === buttons.yes || res === "Yes" ? "yes" : res === buttons.no || res === "No" ? "no" : "cancel";
  },
};

export const tauriPlatform: Platform = {
  kind: "tauri",
  canOverwrite: true,
  files,
  ai,

  async pickFile(kind: FileKind) {
    const path = await open({
      multiple: false,
      directory: false,
      filters: [{ name: ACCEPT[kind].label, extensions: ACCEPT[kind].extensions }],
    });
    if (typeof path !== "string") return null;
    return files.read(path);
  },

  async saveFile(bytes, suggestedName, kind, path) {
    const target = path ?? (await save({
      defaultPath: suggestedName,
      filters: [{ name: ACCEPT[kind].label, extensions: ACCEPT[kind].extensions }],
    }));
    if (!target) return null;
    await writeFile(target, bytes);
    return target;
  },
};
