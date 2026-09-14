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

export type FileKind = "source" | "hbook" | "json" | "csv" | "any";

export interface Platform {
  readonly kind: "tauri" | "web";
  /** Kann an einen bekannten Pfad zurückschreiben (Desktop) – im Web wird jedes Mal heruntergeladen. */
  readonly canOverwrite: boolean;
  /** Datei auswählen und lesen; null bei Abbruch. */
  pickFile(kind: FileKind): Promise<PickedFile | null>;
  /**
   * Datei speichern. Mit `path` ohne Rückfrage dorthin, sonst Dialog bzw. Download.
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
