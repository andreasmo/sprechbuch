/**
 * Block + Markierungen → flache Liste darstellbarer Stücke.
 * Reine Funktion ohne DOM – dieselbe Logik wird der Reader in Phase 2 nutzen.
 */
import type { Annotation, Book, BookBlock, CastEntry } from "@sprechbuch/core";
import { REVIEW_THRESHOLD } from "@sprechbuch/core";

export interface Piece {
  kind: "text" | "pipe";
  text: string;
  speaker?: string | null;
  slot?: number | null;
  weak?: boolean;
  badge?: string;
  quote?: boolean;
}

const TRAIL_CLOSERS = "«»“”‘’‹›\"')]}";

/** Schlusspunkt entfernen, auch vor schließendem Anführungszeichen (»…Lenden.« → »…Lenden«). */
export function stripFinalPeriod(t: string): string {
  let i = t.length;
  while (i > 0 && /\s/.test(t[i - 1]!)) i--;
  let j = i;
  while (j > 0 && TRAIL_CLOSERS.includes(t[j - 1]!)) j--;
  return j > 0 && t[j - 1] === "." ? t.slice(0, j - 1) + t.slice(j) : t;
}

export function slotFor(book: Book, chapterId: string, cast: Map<string, CastEntry>, speaker: string | null | undefined) {
  if (!speaker) return null;
  const c = cast.get(speaker);
  if (c && c.color !== null) return c.color;
  return book.chapterColors[chapterId]?.[speaker] ?? null;
}

export function renderBlock(
  book: Book,
  chapterId: string,
  block: BookBlock,
  annotations: Annotation[],
  cast: Map<string, CastEntry>,
): Piece[] {
  const text = block.text;
  const clamp = (n: number) => Math.max(0, Math.min(text.length, n));
  const cuts = new Set([0, text.length]);
  for (const [a, z] of block.sentences) {
    cuts.add(a);
    cuts.add(z);
  }
  const ranged = annotations.filter((a): a is Extract<Annotation, { start: number }> =>
    (a.type === "speech" || a.type === "quote") && "start" in a);
  for (const a of ranged) {
    cuts.add(clamp(a.start));
    cuts.add(clamp(a.end));
  }
  const points = [...cuts].sort((x, y) => x - y);
  const ends = new Set(block.sentences.map(([, z]) => z));
  const seen = new Set<string>();
  const out: Piece[] = [];

  for (let i = 0; i + 1 < points.length; i++) {
    const x = points[i]!;
    const y = points[i + 1]!;
    let t = text.slice(x, y);
    if (ends.has(y)) t = stripFinalPeriod(t);
    const sp = ranged.find((a) => a.type === "speech" && a.start <= x && y <= a.end);
    const piece: Piece = { kind: "text", text: t };
    if (sp && sp.type === "speech") {
      piece.speaker = sp.speaker;
      piece.slot = slotFor(book, chapterId, cast, sp.speaker);
      piece.weak = sp.origin !== "user" && (!sp.speaker || sp.confidence < REVIEW_THRESHOLD);
      if (!seen.has(sp.id)) {
        seen.add(sp.id);
        piece.badge = sp.speaker ? (cast.get(sp.speaker)?.badge ?? "?") : "?";
      }
    }
    if (ranged.some((a) => a.type === "quote" && a.start <= x && y <= a.end)) piece.quote = true;
    if (t) out.push(piece);
    if (ends.has(y)) out.push({ kind: "pipe", text: " |" });
  }
  return out;
}
