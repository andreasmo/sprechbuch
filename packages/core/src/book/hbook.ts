/**
 * `.hbook`-Container: ZIP mit
 *   mimetype            application/vnd.sprechbuch.book+zip  (zuerst, unkomprimiert)
 *   book.json           das Buch
 *   source/<Dateiname>  optional die Originaldatei
 *   changes.json        optional: Änderungen eines Geräts ohne Dateizugriff (iPad, Browser)
 */
import JSZip from "jszip";
import type { JournalEntry } from "../edit/rebase.js";
import { BookFormatError, migrateBook } from "./migrate.js";
import { HBOOK_MIMETYPE, type Book } from "./schema.js";

/**
 * Übergabe-Protokoll: Ein Gerät, das die Datei nicht selbst zurückschreiben kann (iPad, Browser),
 * legt seine Änderungen als Befehle bei – samt der Fassung, von der es ausging. So kann die
 * Desktop-App sie auf ihren neuesten Stand übertragen, statt ihn zu überschreiben.
 */
export interface HbookChanges {
  /** SHA-256 der .hbook-Fassung, von der das Gerät ausging */
  base: string;
  /** Anzeige, z. B. „iPad“ */
  device: string;
  updatedAt: string;
  /** Befehle seit `base`; null = nicht lückenlos (dann lässt sich nur die ganze Fassung vergleichen) */
  edits: JournalEntry[] | null;
}

export interface HbookContents {
  book: Book;
  /** Originaldatei, falls eingebettet. */
  source: { fileName: string; bytes: Uint8Array } | null;
  /** Übergabe-Protokoll, falls vorhanden */
  changes?: HbookChanges | null;
}

const CHANGES_FORMAT = "sprechbuch-changes";

export async function writeHbook(book: Book, source?: Uint8Array | null, changes?: HbookChanges | null): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("mimetype", HBOOK_MIMETYPE, { compression: "STORE" });
  zip.file("book.json", bookToJson(book), { compression: "DEFLATE", compressionOptions: { level: 6 } });
  if (source && book.meta.source.embedded) {
    // EPUB/PDF sind bereits komprimiert – erneutes Deflate kostet nur Zeit.
    zip.file(`source/${book.meta.source.fileName}`, source, { compression: "STORE" });
  }
  if (changes) {
    // Unkomprimiert: klein, und ohne Entpacken lesbar
    zip.file("changes.json", `${JSON.stringify({ format: CHANGES_FORMAT, version: 1, ...changes }, null, 1)}\n`, { compression: "STORE" });
  }
  return zip.generateAsync({ type: "uint8array", platform: "UNIX" });
}

/** Übergabe-Protokoll lesen – ein beschädigtes Protokoll macht das Buch nicht unlesbar, es fehlt dann nur. */
function parseChanges(json: string | undefined): HbookChanges | null {
  if (!json) return null;
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    if (raw.format !== CHANGES_FORMAT || typeof raw.base !== "string" || !/^[0-9a-f]{64}$/.test(raw.base)) return null;
    const edits = Array.isArray(raw.edits)
      && raw.edits.every((e) => !!e && typeof e === "object" && typeof (e as { edit?: { type?: unknown } }).edit?.type === "string")
      ? (raw.edits as JournalEntry[])
      : null;
    return {
      base: raw.base,
      device: typeof raw.device === "string" ? raw.device : "anderes Gerät",
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "",
      edits,
    };
  } catch {
    return null;
  }
}

export async function readHbook(bytes: Uint8Array | ArrayBuffer): Promise<HbookContents> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new BookFormatError("Keine .hbook-Datei (kein gültiges ZIP-Archiv).");
  }
  const mimetype = await zip.file("mimetype")?.async("string");
  if (mimetype?.trim() !== HBOOK_MIMETYPE) throw new BookFormatError("Keine .hbook-Datei (mimetype fehlt oder ist falsch).");
  const json = await zip.file("book.json")?.async("string");
  if (!json) throw new BookFormatError("Beschädigte .hbook-Datei: book.json fehlt.");
  const book = bookFromJson(json);
  const entry = zip.file(`source/${book.meta.source.fileName}`);
  return {
    book,
    source: entry ? { fileName: book.meta.source.fileName, bytes: await entry.async("uint8array") } : null,
    changes: parseChanges(await zip.file("changes.json")?.async("string")),
  };
}

/** Stabile, gut diff-bare JSON-Darstellung. */
export function bookToJson(book: Book): string {
  return JSON.stringify(book, null, 1) + "\n";
}

export function bookFromJson(json: string): Book {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    throw new BookFormatError(`book.json ist kein gültiges JSON: ${(e as Error).message}`);
  }
  return migrateBook(raw);
}
