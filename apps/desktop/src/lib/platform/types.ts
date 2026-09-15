/**
 * Alles, was vom Betriebssystem abhängt, liegt hinter dieser Schnittstelle.
 * Oberfläche und Kern kennen weder Tauri noch den Browser – dadurch läuft
 * dieselbe App als Desktop-Anwendung und als (lokale oder gehostete) Web-App.
 */
import type { Transport } from "@sprechbuch/core";

/** Fingerabdruck einer Datei auf der Platte – daran werden fremde Änderungen erkannt. */
export interface FileStamp {
  size: number;
  modifiedMs: number;
  /** SHA-256 des Inhalts, sofern gelesen */
  sha256?: string;
}

export interface PickedFile {
  name: string;
  bytes: Uint8Array;
  /** Absoluter Pfad – nur auf dem Desktop bekannt. */
  path?: string;
  stamp?: FileStamp;
}

export type FileKind = "source" | "hbook" | "json" | "csv" | "any";

/** Die Datei wurde seit dem letzten Lesen/Schreiben von außen verändert. */
export class FileConflictError extends Error {
  constructor(readonly current: FileStamp) {
    super("Die Datei wurde außerhalb von Sprechbuch geändert.");
    this.name = "FileConflictError";
  }
}

/** Die Datei ist nicht mehr da (verschoben, umbenannt, gelöscht). */
export class FileMissingError extends Error {
  constructor(message = "Die Datei gibt es nicht mehr.") {
    super(message);
    this.name = "FileMissingError";
  }
}

export interface SaveBookOptions {
  /** Ohne Rückfrage hierhin; fehlt er, erscheint der Speichern-Dialog */
  path?: string;
  /** Vorschlag im Dialog, z. B. neben der Quelldatei */
  suggestedPath?: string;
  /** SHA-256 der Fassung, auf der die Änderungen beruhen – weicht die Datei ab, gibt es einen Konflikt */
  expected?: string;
  /** Konfliktprüfung überspringen */
  force?: boolean;
}

/** Nur auf dem Desktop: Dateien über ihren Pfad lesen, sicher schreiben, beobachten. */
export interface DesktopFiles {
  /** Datei lesen, mit Stempel (inkl. Hash) */
  read(path: string): Promise<PickedFile & { path: string; stamp: FileStamp }>;
  /** Stempel ohne Inhalt; mit `hash` inkl. SHA-256. null, wenn es die Datei nicht gibt */
  stamp(path: string, hash: boolean): Promise<FileStamp | null>;
  /** .hbook atomar schreiben; null bei Abbruch im Dialog. Wirft FileConflictError/FileMissingError */
  saveBook(bytes: Uint8Array, opts: SaveBookOptions): Promise<{ path: string; stamp: FileStamp } | null>;
  /** Dateien, mit denen die App gestartet oder erneut aufgerufen wurde (Doppelklick, „Öffnen mit“) */
  onOpenFiles(handler: (paths: string[]) => void): Promise<() => void>;
  /** Dateien ins Fenster gezogen – mit echten Pfaden (anders als HTML-Drag-&-Drop) */
  onDragDrop(handler: { over: (active: boolean) => void; drop: (paths: string[]) => void }): Promise<() => void>;
  /** Vor dem Schließen des Fensters; false verhindert das Schließen */
  onCloseRequested(handler: () => Promise<boolean>): Promise<() => void>;
  /** Frage mit drei Antworten */
  ask(message: string, buttons: { yes: string; no: string; cancel: string }, title?: string): Promise<"yes" | "no" | "cancel">;
}

export interface AiKeyStatus {
  baseUrl: string;
  /** letzte vier Zeichen */
  hint: string;
}

/** KI-Zugang: Schlüsselverwaltung und Transport, der den Schlüssel anhängt */
export interface AiBridge {
  /** Desktop: Tresor des Betriebssystems; Web: nur bis zum Schließen der Seite im Arbeitsspeicher */
  readonly keyStorage: "os" | "memory";
  keyStatus(provider: string): Promise<AiKeyStatus | null>;
  setKey(provider: string, baseUrl: string, key: string): Promise<void>;
  deleteKey(provider: string): Promise<void>;
  /** Darf Text an Cloud-Anbieter gehen? Standard: nein („Nur lokale KI“), durchgesetzt im Transport */
  allowCloud(): Promise<boolean>;
  /** Erlauben fragt nach (Desktop: nativer Dialog); liefert den neuen Stand */
  setAllowCloud(allow: boolean): Promise<boolean>;
  /** Abbrechen über das Signal schließt die Verbindung */
  transport: Transport;
}

export interface Platform {
  readonly kind: "tauri" | "web";
  readonly ai: AiBridge;
  /** Kann an einen bekannten Pfad zurückschreiben (Desktop) – im Web wird jedes Mal heruntergeladen. */
  readonly canOverwrite: boolean;
  /** Nur Desktop */
  readonly files?: DesktopFiles;
  /** Datei auswählen und lesen; null bei Abbruch. */
  pickFile(kind: FileKind): Promise<PickedFile | null>;
  /**
   * Export speichern (JSON, CSV) bzw. im Web herunterladen. Mit `path` ohne Rückfrage dorthin, sonst Dialog.
   * Liefert den Pfad (Desktop) bzw. Dateinamen (Web) oder null bei Abbruch.
   */
  saveFile(bytes: Uint8Array, suggestedName: string, kind: Exclude<FileKind, "any" | "source">, path?: string): Promise<string | null>;
}

export const ACCEPT: Record<FileKind, { label: string; extensions: string[]; mime: string }> = {
  source: { label: "Bücher (EPUB, PDF)", extensions: ["epub", "pdf"], mime: "application/octet-stream" },
  hbook: { label: "Sprechbuch", extensions: ["hbook"], mime: "application/vnd.sprechbuch.book+zip" },
  json: { label: "Sprechbuch als JSON", extensions: ["json"], mime: "application/json" },
  csv: { label: "Tabelle (CSV)", extensions: ["csv"], mime: "text/csv" },
  any: { label: "Bücher und Sprechbuch-Dateien", extensions: ["epub", "pdf", "hbook", "json"], mime: "application/octet-stream" },
};

const sep = (path: string) => (path.includes("\\") && !path.includes("/") ? "\\" : "/");

export const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** C:\…, \\server\…, /… – nur solche Pfade kann die Desktop-App lesen und schreiben */
export const isAbsolutePath = (path: string) => /^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(path);

/** Gleicher Ordner, anderer Dateiname */
export function siblingPath(path: string, fileName: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i < 0 ? fileName : `${path.slice(0, i)}${sep(path)}${fileName}`;
}
