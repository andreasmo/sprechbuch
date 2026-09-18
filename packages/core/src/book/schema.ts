/**
 * Das Buchformat von Sprechbuch (`book.json` in einer `.hbook`-Datei).
 *
 * Grundregeln (siehe docs/bookfile-format.md):
 *  - Text und Markierungen sind getrennt. Blöcke haben stabile IDs, Markierungen
 *    verweisen auf `block` + Offsets.
 *  - Offsets zählen UTF-16-Codeeinheiten (JavaScript-String-Indizes).
 *  - Jede Markierung trägt ihre Herkunft; `user` wird von keiner automatischen
 *    Analyse überschrieben.
 *  - Unbekannte Felder bleiben beim Lesen und Schreiben erhalten (Erweiterungen).
 */
import { z } from "zod";

export const BOOK_FORMAT = "sprechbuch";
export const SCHEMA_VERSION = 1;
export const HBOOK_MIMETYPE = "application/vnd.sprechbuch.book+zip";

const id = z.string().min(1);
const offset = z.number().int().nonnegative();
const confidence = z.number().min(0).max(1);

export const Origin = z.enum(["rule", "llm", "user"]);
export type Origin = z.infer<typeof Origin>;

export const SourceFormat = z.enum(["epub", "pdf", "docx", "html", "txt"]);
export type SourceFormat = z.infer<typeof SourceFormat>;

export const QuoteStyleSchema = z.looseObject({
  name: z.string(),
  open: z.string(),
  close: z.string(),
});

export const BookMeta = z.looseObject({
  title: z.string(),
  author: z.string().optional(),
  language: z.string().optional(),
  publisher: z.string().optional(),
  date: z.string().optional(),
  source: z.looseObject({
    fileName: z.string(),
    format: SourceFormat,
    size: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    /** Liegt die Originaldatei in der .hbook unter `source/<fileName>`? */
    embedded: z.boolean(),
  }),
  quoteStyle: QuoteStyleSchema,
  createdWith: z.string(),
  createdAt: z.string(),
  modifiedAt: z.string(),
});

export const GenderSchema = z.enum(["m", "f", "?"]);

export const CastEntry = z.looseObject({
  id,
  name: z.string().min(1),
  aliases: z.array(z.string()),
  gender: GenderSchema,
  /** Buchweit fester Markerslot (Index in MARKER_SLOTS) oder null = kapitelweise. */
  color: z.number().int().min(0).nullable(),
  badge: z.string(),
  voiceNote: z.string(),
  kind: z.enum(["name", "np", "pron"]),
  origin: Origin,
});
export type CastEntry = z.infer<typeof CastEntry>;

export const FormatSpan = z.looseObject({
  start: offset,
  end: offset,
  kind: z.enum(["em", "strong"]),
});

export const BlockSchema = z.looseObject({
  id,
  type: z.enum(["h1", "h2", "p", "quote", "verse"]),
  text: z.string(),
  /** Satzgrenzen als [start, ende)-Paare. */
  sentences: z.array(z.tuple([offset, offset])),
  /** Kursiv/Fett aus der Quelle. */
  format: z.array(FormatSpan).optional(),
});
export type BookBlock = z.infer<typeof BlockSchema>;

export const ChapterSchema = z.looseObject({
  id,
  title: z.string(),
  blocks: z.array(BlockSchema),
});
export type BookChapter = z.infer<typeof ChapterSchema>;

const ranged = { id, block: id, start: offset, end: offset };
const point = { id, block: id, at: offset };

export const SpeechAnnotation = z.looseObject({
  type: z.literal("speech"),
  ...ranged,
  speaker: id.nullable(),
  origin: Origin,
  confidence,
  /** Wie die Automatik zugeordnet hat (inquit_after, alternation, …). */
  via: z.string().nullable().optional(),
  /** Setzt eine offene Rede aus dem vorigen Absatz fort. */
  continued: z.boolean().optional(),
  /**
   * Abweichende Einschätzung, die in der Prüfung angeboten wird – z. B. die KI sieht eine andere
   * Figur als die Regeln, oder die KI hat übernommen und die Regel-Zuordnung bleibt als Alternative.
   */
  suggestion: z.looseObject({
    speaker: id.nullable(),
    confidence,
    source: z.enum(["rule", "llm"]),
    /** Keine direkte Rede (Titel, Schild, zitiertes Wort) */
    notSpeech: z.boolean().optional(),
    /** Kurze Begründung */
    note: z.string().optional(),
  }).optional(),
});
export type SpeechAnnotation = z.infer<typeof SpeechAnnotation>;

/**
 * Handschrift an einer Notiz. Die Striche sind auf die Breite der Schreibfläche normiert (0–1000),
 * y in derselben Einheit – so skaliert die Schrift mit Schriftgröße und Randbreite, ohne zu verzerren.
 */
export const InkSchema = z.looseObject({
  /** Höhe in Tausendsteln der Breite */
  h: z.number().int().positive(),
  /** Strichstärke in Tausendsteln der Breite */
  w: z.number().positive(),
  /** Je Strich x,y im Wechsel, ganzzahlig */
  strokes: z.array(z.array(z.number().int()).min(2).refine((s) => s.length % 2 === 0, "Strich: x,y-Paare erwartet")),
});
export type Ink = z.infer<typeof InkSchema>;

export const Annotation = z.discriminatedUnion("type", [
  SpeechAnnotation,
  /** Zitat innerhalb einer Rede (›…‹) – erbt die Figur der umgebenden Rede. */
  z.looseObject({ type: z.literal("quote"), ...ranged, origin: Origin }),
  /** `color`: Stiftfarbe (Index in PEN_SLOTS); fehlt = schlichte Betonung. Unbekannte Farben gelten als schlicht. */
  z.looseObject({ type: z.literal("emphasis"), ...ranged, color: z.number().int().min(0).optional(), origin: Origin }),
  z.looseObject({ type: z.literal("retake"), ...ranged, note: z.string().optional(), origin: Origin }),
  z.looseObject({ type: z.literal("bookmark"), ...ranged, origin: Origin }),
  /** `text` kann leer sein, wenn die Notiz handschriftlich ist (`ink`). */
  z.looseObject({ type: z.literal("note"), ...ranged, text: z.string(), ink: InkSchema.optional(), origin: Origin }),
  z.looseObject({ type: z.literal("pause"), ...point, length: z.enum(["short", "long"]), origin: Origin }),
  z.looseObject({ type: z.literal("breath"), ...point, origin: Origin }),
]);
export type Annotation = z.infer<typeof Annotation>;

export const Pronunciation = z.looseObject({
  term: z.string().min(1),
  kind: z.enum(["figure", "name", "long", "foreign"]),
  count: z.number().int().nonnegative(),
  hint: z.string(),
  ipa: z.string(),
  origin: Origin,
  verified: z.boolean(),
});
export type Pronunciation = z.infer<typeof Pronunciation>;

export const BookSchema = z.looseObject({
  format: z.literal(BOOK_FORMAT),
  schemaVersion: z.literal(SCHEMA_VERSION),
  id,
  meta: BookMeta,
  cast: z.array(CastEntry),
  chapters: z.array(ChapterSchema),
  annotations: z.array(Annotation),
  /** Kapitelweise Markerslots für Figuren ohne feste Farbe. */
  chapterColors: z.record(z.string(), z.record(z.string(), z.number().int().min(0).nullable())),
  /** Bedeutung der Stiftfarben in diesem Buch (Index wie PEN_SLOTS), z. B. „langsamer“; leer = nur der Farbname. */
  emphasisLabels: z.array(z.string()).optional(),
  pronunciations: z.array(Pronunciation),
  progress: z.looseObject({ block: id, sentence: z.number().int().nonnegative() }).nullable(),
});
export type Book = z.infer<typeof BookSchema>;
