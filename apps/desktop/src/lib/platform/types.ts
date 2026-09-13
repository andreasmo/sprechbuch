/**
 * Alles, was vom Betriebssystem abhängt, liegt hinter dieser Schnittstelle.
 * Oberfläche und Kern kennen weder Tauri noch den Browser – dadurch läuft
 * dieselbe App als Desktop-Anwendung und als (lokale oder gehostete) Web-App.
 */
export interface PickedFile {
  name: string;
  bytes: Uint8Array;
  /** Absoluter Pfad – nur auf dem Desktop bekannt. */
  path?: string;
}

export type FileKind = "source" | "hbook";

export interface Platform {
  readonly kind: "tauri" | "web";
  /** Datei auswählen und lesen; null bei Abbruch. */
  pickFile(kind: FileKind): Promise<PickedFile | null>;
  /**
   * .hbook speichern. Ohne `path` wird nach dem Ziel gefragt.
   * Liefert den Pfad (Desktop) bzw. Dateinamen (Web) oder null bei Abbruch.
   */
  saveHbook(bytes: Uint8Array, suggestedName: string, path?: string): Promise<string | null>;
}

export const ACCEPT: Record<FileKind, { label: string; extensions: string[]; mime: string[] }> = {
  source: { label: "Bücher (EPUB, PDF)", extensions: ["epub", "pdf"], mime: ["application/epub+zip", "application/pdf"] },
  hbook: { label: "Sprechbuch", extensions: ["hbook"], mime: ["application/vnd.sprechbuch.book+zip"] },
};
