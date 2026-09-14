/**
 * Absatz + Markierungen → Satzsegmente mit darstellbaren Stücken.
 *
 * Reine Funktion ohne DOM. Jedes Textstück kennt seine Offsets im Absatztext –
 * darüber übersetzt die Oberfläche Klicks und Textauswahl zurück in Positionen.
 */
import { REVIEW_THRESHOLD, slotOf, type Annotation, type Book, type BookBlock, type CastEntry } from "@sprechbuch/core";

export interface SpeechInfo {
  id: string;
  speaker: string | null;
  slot: number | null;
  /** automatisch und unsicher – wird schraffiert dargestellt */
  weak: boolean;
  user: boolean;
  /** nur am ersten Stück einer Redepassage */
  badge?: string;
}

export interface TextPiece {
  kind: "text";
  start: number;
  end: number;
  text: string;
  speech?: SpeechInfo;
  quote?: boolean;
  italic?: boolean;
  bold?: boolean;
  emphasis?: boolean;
  retake?: boolean;
  note?: boolean;
  bookmark?: boolean;
  /** Markierungen, die an diesem Stück beginnen (für Symbole wie ★ ✎ ⟲) */
  starts?: { id: string; type: "retake" | "note" | "bookmark"; text?: string }[];
}

export interface PointPiece {
  kind: "point";
  id: string;
  at: number;
  mark: "pause" | "breath";
  long: boolean;
}

export type Piece = TextPiece | PointPiece;

export interface Segment {
  /** Satzindex im Absatz, null für Leerraum zwischen Sätzen oder Überschriften */
  sentence: number | null;
  start: number;
  end: number;
  /** Wörter im Satz (0 für Leerraum) */
  words: number;
  pieces: Piece[];
}

/** Ab dieser Wortzahl wird ein Satz als lang markiert (Atemplanung). */
export const LONG_SENTENCE = 28;

const countWords = (t: string) => (t.match(/\p{L}+/gu) ?? []).length;

const TRAIL_CLOSERS = "«»“”‘’‹›\"')]}";

/** Schlusspunkt entfernen, auch vor schließendem Anführungszeichen (»…Lenden.« → »…Lenden«). */
export function stripFinalPeriod(t: string): string {
  let i = t.length;
  while (i > 0 && /\s/.test(t[i - 1]!)) i--;
  let j = i;
  while (j > 0 && TRAIL_CLOSERS.includes(t[j - 1]!)) j--;
  return j > 0 && t[j - 1] === "." ? t.slice(0, j - 1) + t.slice(j) : t;
}

type Ranged = Extract<Annotation, { start: number }>;
type Point = Extract<Annotation, { at: number }>;

export function renderBlock(
  book: Book,
  chapterId: string,
  block: BookBlock,
  annotations: readonly Annotation[],
  cast: Map<string, CastEntry>,
  opts: { stripPeriods?: boolean } = {},
): Segment[] {
  const text = block.text;
  const len = text.length;
  const clamp = (n: number) => Math.max(0, Math.min(len, n));
  const ranged = annotations.filter((a): a is Ranged => a.type !== "pause" && a.type !== "breath");
  const points = annotations.filter((a): a is Point => a.type === "pause" || a.type === "breath")
    .sort((x, y) => x.at - y.at);
  const format = block.format ?? [];

  const cuts = new Set([0, len]);
  for (const [a, z] of block.sentences) cuts.add(clamp(a)).add(clamp(z));
  for (const a of ranged) cuts.add(clamp(a.start)).add(clamp(a.end));
  for (const f of format) cuts.add(clamp(f.start)).add(clamp(f.end));
  for (const p of points) cuts.add(clamp(p.at));
  const sorted = [...cuts].sort((x, y) => x - y);

  // Segmente: Sätze und die Lücken dazwischen
  const bounds: { sentence: number | null; start: number; end: number }[] = [];
  let pos = 0;
  block.sentences.forEach(([a, z], i) => {
    if (a > pos) bounds.push({ sentence: null, start: pos, end: a });
    bounds.push({ sentence: i, start: a, end: z });
    pos = z;
  });
  if (pos < len || !bounds.length) bounds.push({ sentence: null, start: pos, end: len });

  const seenSpeech = new Set<string>();
  const seenStart = new Set<string>();
  const placedPoints = new Set<string>();
  const covers = (a: { start: number; end: number }, x: number, y: number) => a.start <= x && y <= a.end;

  return bounds.map((seg) => {
    const pieces: Piece[] = [];
    const inner = sorted.filter((c) => c >= seg.start && c <= seg.end);
    const placePoints = (at: number) => {
      for (const p of points) {
        if (p.at === at && !placedPoints.has(p.id)) {
          placedPoints.add(p.id);
          pieces.push({ kind: "point", id: p.id, at, mark: p.type, long: p.type === "pause" && p.length === "long" });
        }
      }
    };
    for (let i = 0; i + 1 < inner.length; i++) {
      const x = inner[i]!;
      const y = inner[i + 1]!;
      placePoints(x);
      if (x === y) continue;
      const piece: TextPiece = { kind: "text", start: x, end: y, text: text.slice(x, y) };
      for (const a of ranged) {
        if (!covers(a, x, y)) continue;
        switch (a.type) {
          case "speech": {
            const info: SpeechInfo = {
              id: a.id,
              speaker: a.speaker,
              slot: slotOf(book, chapterId, a.speaker, cast),
              weak: a.origin !== "user" && (a.speaker === null || a.confidence < REVIEW_THRESHOLD),
              user: a.origin === "user",
            };
            if (!seenSpeech.has(a.id)) {
              seenSpeech.add(a.id);
              info.badge = a.speaker ? (cast.get(a.speaker)?.badge ?? "?") : "?";
            }
            piece.speech = info;
            break;
          }
          case "quote": piece.quote = true; break;
          case "emphasis": piece.emphasis = true; break;
          case "retake": case "note": case "bookmark": {
            piece[a.type] = true;
            if (!seenStart.has(a.id)) {
              seenStart.add(a.id);
              (piece.starts ??= []).push({ id: a.id, type: a.type, ...(a.type === "note" ? { text: a.text } : a.type === "retake" && a.note ? { text: a.note } : {}) });
            }
            break;
          }
        }
      }
      for (const f of format) {
        if (covers(f, x, y)) {
          if (f.kind === "em") piece.italic = true;
          else piece.bold = true;
        }
      }
      pieces.push(piece);
    }
    placePoints(seg.end);
    if (opts.stripPeriods !== false && seg.sentence !== null) {
      for (let i = pieces.length - 1; i >= 0; i--) {
        const p = pieces[i]!;
        if (p.kind === "text") {
          p.text = stripFinalPeriod(p.text);
          break;
        }
      }
    }
    return { ...seg, words: seg.sentence === null ? 0 : countWords(text.slice(seg.start, seg.end)), pieces };
  });
}

/** Stellen, an denen man Luft holen kann: Komma, Semikolon, Doppelpunkt, frei stehender Gedankenstrich. */
const BREATH_AT = /[,;:]|(?<=\s)[–—](?=\s)/gu;

export interface TextChunk {
  start: number;
  end: number;
  text: string;
  breath: boolean;
}

/**
 * Text eines Stücks an Atemstellen zerlegen. Jeder Teil behält seine Offsets,
 * damit Klick und Auswahl weiter exakt zurückgerechnet werden. null = nichts zu zerlegen.
 */
export function breathChunks(text: string, start: number): TextChunk[] | null {
  const out: TextChunk[] = [];
  let pos = 0;
  for (const m of text.matchAll(BREATH_AT)) {
    const i = m.index;
    if (i > pos) out.push({ start: start + pos, end: start + i, text: text.slice(pos, i), breath: false });
    out.push({ start: start + i, end: start + i + m[0].length, text: m[0], breath: true });
    pos = i + m[0].length;
  }
  if (!out.length) return null;
  if (pos < text.length) out.push({ start: start + pos, end: start + text.length, text: text.slice(pos), breath: false });
  return out;
}

/** Laufende Satznummer (ab 1) des ersten Satzes jedes Absatzes im Kapitel. */
export function sentenceNumbers(chapter: Book["chapters"][number]): Map<string, number> {
  const out = new Map<string, number>();
  let n = 1;
  for (const b of chapter.blocks) {
    out.set(b.id, n);
    n += b.sentences.length;
  }
  return out;
}

/** Satz, der den Offset enthält – liegt er zwischen zwei Sätzen, der folgende. */
export function sentenceAt(block: BookBlock, offset: number): number {
  const i = block.sentences.findIndex(([, z]) => offset < z);
  return i === -1 ? Math.max(0, block.sentences.length - 1) : i;
}

/** Figuren mit Rede in einem Kapitel, häufigste zuerst – Reihenfolge der Tasten 1–9. */
export function chapterCast(chapter: Book["chapters"][number], byBlock: Map<string, Annotation[]>): { id: string | null; n: number }[] {
  const counts = new Map<string | null, number>();
  for (const b of chapter.blocks) {
    for (const a of byBlock.get(b.id) ?? []) {
      if (a.type === "speech") counts.set(a.speaker, (counts.get(a.speaker) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([id, n]) => ({ id, n }))
    .sort((a, b) => Number(a.id === null) - Number(b.id === null) || b.n - a.n);
}

/** Satzliste eines Kapitels in Lesereihenfolge – für Navigation im Aufnahmemodus. */
export interface SentenceRef {
  block: string;
  sentence: number;
  start: number;
  end: number;
  words: number;
}

export function chapterSentences(chapter: Book["chapters"][number]): SentenceRef[] {
  const out: SentenceRef[] = [];
  for (const b of chapter.blocks) {
    b.sentences.forEach(([s, e], i) => {
      out.push({ block: b.id, sentence: i, start: s, end: e, words: countWords(b.text.slice(s, e)) });
    });
  }
  return out;
}

const WORD_CHAR = /[\p{L}\p{N}'’-]/u;
const QUOTE_OPEN = "»„“‚›‹«\"'(";
const QUOTE_CLOSE = "«“”‘‹›»\"')";

/**
 * Auswahl auf ganze Wörter erweitern – wer »ara, der« erwischt, meint »Makara, der«.
 * Mit `quotes` werden direkt angrenzende Anführungszeichen mitgenommen (für Rede).
 */
export function snapSelection(text: string, start: number, end: number, quotes = false): [number, number] {
  let s = Math.max(0, Math.min(start, end));
  let e = Math.min(text.length, Math.max(start, end));
  while (s > 0 && WORD_CHAR.test(text[s - 1]!) && WORD_CHAR.test(text[s] ?? "")) s--;
  while (e < text.length && WORD_CHAR.test(text[e]!) && WORD_CHAR.test(text[e - 1] ?? "")) e++;
  // Leerraum an den Rändern der Auswahl ignorieren
  while (s < e && /\s/u.test(text[s]!)) s++;
  while (e > s && /\s/u.test(text[e - 1]!)) e--;
  if (quotes) {
    while (s > 0 && QUOTE_OPEN.includes(text[s - 1]!)) s--;
    while (e < text.length && QUOTE_CLOSE.includes(text[e]!)) e++;
  }
  return [s, e];
}
