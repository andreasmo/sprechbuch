import { BOOK_FORMAT, BookSchema, SCHEMA_VERSION, type Book } from "./schema.js";

export class BookFormatError extends Error {
  constructor(message: string, readonly details?: unknown) {
    super(message);
    this.name = "BookFormatError";
  }
}

type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/**
 * Schritte von Version n auf n+1. Neue Schemaversion = neuer Eintrag hier plus
 * ein Test mit einer Datei im alten Format. Bestehende Schritte nie ändern.
 */
const MIGRATIONS: Record<number, Migration> = {};

/** Liest beliebige ältere Versionen ein, prüft das Ergebnis gegen das aktuelle Schema. */
export function migrateBook(input: unknown): Book {
  if (!input || typeof input !== "object") throw new BookFormatError("Keine Buchdatei: JSON-Objekt erwartet.");
  let raw = input as Record<string, unknown>;
  if (raw.format !== BOOK_FORMAT) throw new BookFormatError("Keine Sprechbuch-Datei (Feld »format« fehlt oder ist falsch).");
  let version = raw.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new BookFormatError(`Ungültige Schemaversion: ${String(version)}`);
  }
  if (version > SCHEMA_VERSION) {
    throw new BookFormatError(
      `Diese Datei stammt aus einer neueren Sprechbuch-Version (Format ${version}, unterstützt bis ${SCHEMA_VERSION}). Bitte Sprechbuch aktualisieren.`,
    );
  }
  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) throw new BookFormatError(`Keine Migration von Format ${version} vorhanden.`);
    raw = { ...step(raw), schemaVersion: version + 1 };
    version++;
  }
  return validateBook(raw);
}

export function validateBook(raw: unknown): Book {
  const res = BookSchema.safeParse(raw);
  if (!res.success) {
    const first = res.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(Wurzel)"}: ${i.message}`);
    throw new BookFormatError(`Buchdatei ist beschädigt oder ungültig:\n  ${first.join("\n  ")}`, res.error.issues);
  }
  checkReferences(res.data);
  return res.data;
}

/** Querverweise, die das Schema allein nicht prüfen kann. */
function checkReferences(book: Book): void {
  const blocks = new Map<string, number>();
  for (const ch of book.chapters) {
    for (const b of ch.blocks) {
      if (blocks.has(b.id)) throw new BookFormatError(`Block-ID doppelt: ${b.id}`);
      blocks.set(b.id, b.text.length);
      for (const [s, e] of b.sentences) {
        if (s > e || e > b.text.length) throw new BookFormatError(`Satzgrenze außerhalb des Textes in ${b.id}`);
      }
    }
  }
  const cast = new Set(book.cast.map((c) => c.id));
  const ids = new Set<string>();
  for (const a of book.annotations) {
    if (ids.has(a.id)) throw new BookFormatError(`Markierungs-ID doppelt: ${a.id}`);
    ids.add(a.id);
    const len = blocks.get(a.block);
    if (len === undefined) throw new BookFormatError(`Markierung ${a.id} verweist auf unbekannten Block ${a.block}`);
    const point = a.type === "pause" || a.type === "breath";
    const start = point ? a.at : a.start;
    const end = point ? a.at : a.end;
    if (start > end || end > len) throw new BookFormatError(`Markierung ${a.id} liegt außerhalb des Blocktextes`);
    if (a.type === "speech" && a.speaker !== null && !cast.has(a.speaker)) {
      throw new BookFormatError(`Markierung ${a.id} verweist auf unbekannte Figur ${a.speaker}`);
    }
  }
}
