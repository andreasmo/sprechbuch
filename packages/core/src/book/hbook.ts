/**
 * `.hbook`-Container: ZIP mit
 *   mimetype            application/vnd.sprechbuch.book+zip  (zuerst, unkomprimiert)
 *   book.json           das Buch
 *   source/<Dateiname>  optional die Originaldatei
 */
import JSZip from "jszip";
import { BookFormatError, migrateBook } from "./migrate.js";
import { HBOOK_MIMETYPE, type Book } from "./schema.js";

export interface HbookContents {
  book: Book;
  /** Originaldatei, falls eingebettet. */
  source: { fileName: string; bytes: Uint8Array } | null;
}

export async function writeHbook(book: Book, source?: Uint8Array | null): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("mimetype", HBOOK_MIMETYPE, { compression: "STORE" });
  zip.file("book.json", bookToJson(book), { compression: "DEFLATE", compressionOptions: { level: 6 } });
  if (source && book.meta.source.embedded) {
    // EPUB/PDF sind bereits komprimiert – erneutes Deflate kostet nur Zeit.
    zip.file(`source/${book.meta.source.fileName}`, source, { compression: "STORE" });
  }
  return zip.generateAsync({ type: "uint8array", platform: "UNIX" });
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
