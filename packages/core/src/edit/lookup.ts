import type { Annotation, Book, BookBlock, BookChapter, CastEntry, SpeechAnnotation } from "../book/schema.js";

export interface BlockRef {
  chapter: BookChapter;
  chapterIndex: number;
  block: BookBlock;
  blockIndex: number;
}

/** Nachschlagetabellen für ein Buch – einmal pro Änderung neu bauen, alles O(n). */
export interface BookLookup {
  blocks: Map<string, BlockRef>;
  byBlock: Map<string, Annotation[]>;
  cast: Map<string, CastEntry>;
  /** Position eines Blocks im ganzen Buch – für Sortierung in Lesereihenfolge. */
  order: Map<string, number>;
}

export function buildLookup(book: Book): BookLookup {
  const blocks = new Map<string, BlockRef>();
  const order = new Map<string, number>();
  let n = 0;
  book.chapters.forEach((chapter, chapterIndex) => {
    chapter.blocks.forEach((block, blockIndex) => {
      blocks.set(block.id, { chapter, chapterIndex, block, blockIndex });
      order.set(block.id, n++);
    });
  });
  const byBlock = new Map<string, Annotation[]>();
  for (const a of book.annotations) {
    const list = byBlock.get(a.block);
    if (list) list.push(a);
    else byBlock.set(a.block, [a]);
  }
  for (const list of byBlock.values()) list.sort((x, y) => startOf(x) - startOf(y));
  return { blocks, byBlock, cast: new Map(book.cast.map((c) => [c.id, c])), order };
}

const isPoint = (a: Annotation): a is Extract<Annotation, { type: "pause" | "breath" }> =>
  a.type === "pause" || a.type === "breath";
export const startOf = (a: Annotation): number => (isPoint(a) ? a.at : a.start);
export const endOf = (a: Annotation): number => (isPoint(a) ? a.at : a.end);

/** Unter dieser Konfidenz landet eine automatische Zuordnung in der Prüf-Warteschlange. */
export const REVIEW_THRESHOLD = 0.5;

export const needsReview = (a: Annotation, threshold = REVIEW_THRESHOLD): a is SpeechAnnotation =>
  a.type === "speech" && a.origin !== "user" && (a.speaker === null || a.confidence < threshold);

/** Alle ungeprüften, unsicheren Redeteile in Lesereihenfolge. */
export function reviewQueue(book: Book, threshold = REVIEW_THRESHOLD, lookup = buildLookup(book)): SpeechAnnotation[] {
  return book.annotations
    .filter((a): a is SpeechAnnotation => needsReview(a, threshold))
    .sort((x, y) => (lookup.order.get(x.block) ?? 0) - (lookup.order.get(y.block) ?? 0) || x.start - y.start);
}

/** Kapitelweise Figurenfarbe bzw. buchweit feste Farbe. */
export function slotOf(book: Book, chapterId: string, speaker: string | null | undefined, cast?: Map<string, CastEntry>): number | null {
  if (!speaker) return null;
  const c = cast ? cast.get(speaker) : book.cast.find((x) => x.id === speaker);
  if (c && c.color !== null) return c.color;
  return book.chapterColors[chapterId]?.[speaker] ?? null;
}
