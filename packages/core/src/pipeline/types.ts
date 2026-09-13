/**
 * Internes Arbeitsmodell der Analyse-Pipeline.
 *
 * Bewusst deckungsgleich mit dem Dokumentmodell der Python-Referenz
 * (`reference/python`), damit Paritätstests Feld für Feld vergleichen können.
 * Das gespeicherte Buchformat (`book/`) wird erst am Ende daraus erzeugt.
 */

export type BlockType = "h1" | "h2" | "p" | "quote" | "verse";
export type FormatKind = "em" | "strong";

export interface FormatMark {
  s: number;
  e: number;
  k: FormatKind;
}

export interface SpeechSpan {
  s: number;
  e: number;
  open_end: boolean;
  cont: boolean;
  inner: boolean;
  speaker?: string | null;
  conf?: number;
  via?: string | null;
  /** Nur während der Zuordnung. */
  _pron?: string;
  _resp?: boolean;
  _back?: InquitHit | null;
}

export interface InquitHit {
  surface: string;
  kind: SubjectKind;
  verb: string;
}

export type SubjectKind = "pron" | "np" | "name";

export interface Block {
  type: BlockType;
  text: string;
  marks: FormatMark[];
  sent?: [number, number][];
  sid?: number[];
  words?: number;
  speech?: SpeechSpan[];
}

export interface Chapter {
  id: string;
  src: string;
  title: string;
  blocks: Block[];
  n_sentences?: number;
}

export interface QuoteStyle {
  open: string;
  close: string;
  name: "guillemets_de" | "guillemets_fr" | "low_high_de" | "curly_en" | "straight" | "dash" | "none";
}

export type Gender = "m" | "f" | "?";

export interface CastMember {
  id: string;
  name: string;
  aliases: string[];
  gender: Gender;
  color: number | null;
  badge: string;
  note: string;
  pinned: boolean;
  lines: number;
  words: number;
  chapters: string[];
  first: string | null;
  kind: SubjectKind | "name";
  slot?: number | null;
}

/** Vorgabe aus einer Figurenliste (z. B. aus einer bestehenden Buchdatei). */
export interface CastPreset {
  id?: string;
  name: string;
  aliases?: string[];
  gender?: Gender;
  color?: number | null;
  badge?: string;
  note?: string;
  kind?: SubjectKind;
}

export interface DocMeta {
  title?: string;
  author?: string;
  language?: string;
  publisher?: string;
  date?: string;
  source?: string;
  source_format?: string;
  quote_style?: QuoteStyle;
  n_sentences?: number;
  n_words?: number;
}

export interface Doc {
  meta: DocMeta;
  chapters: Chapter[];
  cast?: CastMember[];
  chapter_colors?: Record<string, Record<string, number | null>>;
}
