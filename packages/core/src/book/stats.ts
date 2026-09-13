import { wordCount } from "../text.js";
import type { Book } from "./schema.js";

export interface BookStats {
  chapters: number;
  blocks: number;
  sentences: number;
  words: number;
  speech: number;
  unattributed: number;
  /** Anzahl Redeteile je Zuordnungsverfahren (`user` für manuelle Entscheidungen). */
  byVia: Record<string, number>;
  /** Redeteile unter der Prüfschwelle – Kandidaten für die Prüf-Warteschlange. */
  needsReview: number;
  cast: { id: string; name: string; lines: number; words: number; chapters: number; color: number | null }[];
  /** Geschätzte Sprechdauer in Minuten. */
  minutes: number;
}

export const REVIEW_THRESHOLD = 0.5;

export function bookStats(book: Book, wpm = 150): BookStats {
  const blockText = new Map<string, string>();
  const blockChapter = new Map<string, string>();
  let blocks = 0;
  let sentences = 0;
  let words = 0;
  for (const ch of book.chapters) {
    for (const b of ch.blocks) {
      blocks++;
      sentences += b.sentences.length;
      words += wordCount(b.text);
      blockText.set(b.id, b.text);
      blockChapter.set(b.id, ch.id);
    }
  }
  const per = new Map(book.cast.map((c) => [c.id, { lines: 0, words: 0, chapters: new Set<string>() }]));
  const byVia: Record<string, number> = {};
  let speech = 0;
  let unattributed = 0;
  let needsReview = 0;
  for (const a of book.annotations) {
    if (a.type !== "speech") continue;
    speech++;
    const via = a.origin === "user" ? "user" : (a.via ?? "unknown");
    byVia[via] = (byVia[via] ?? 0) + 1;
    if (!a.speaker) unattributed++;
    if (a.origin !== "user" && (!a.speaker || a.confidence < REVIEW_THRESHOLD)) needsReview++;
    const p = a.speaker ? per.get(a.speaker) : undefined;
    if (p) {
      p.lines++;
      p.words += wordCount(blockText.get(a.block)!.slice(a.start, a.end));
      p.chapters.add(blockChapter.get(a.block)!);
    }
  }
  return {
    chapters: book.chapters.length, blocks, sentences, words, speech, unattributed, byVia, needsReview,
    cast: book.cast
      .map((c) => ({ id: c.id, name: c.name, color: c.color, lines: per.get(c.id)!.lines,
        words: per.get(c.id)!.words, chapters: per.get(c.id)!.chapters.size }))
      .sort((a, b) => b.lines - a.lines),
    minutes: Math.round(words / wpm),
  };
}
