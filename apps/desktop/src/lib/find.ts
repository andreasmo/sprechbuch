/**
 * Suchen und Springen im Buch – reine Funktionen ohne DOM.
 */
import { escapeRe, type Annotation, type Book } from "@sprechbuch/core";
import { chapterSentences } from "./render";

export interface SearchHit {
  chapterIndex: number;
  block: string;
  start: number;
  end: number;
}

export interface SearchResult {
  hits: SearchHit[];
  /** Es gäbe mehr Treffer als `limit` */
  truncated: boolean;
}

/**
 * Volltextsuche ohne Groß-/Kleinschreibung. Gerade und typografische Anführungszeichen
 * und Apostrophe gelten als gleich, Leerraum als beliebig lang.
 */
export function findHits(book: Book, query: string, limit = 1000): SearchResult {
  const q = query.trim();
  if (q.length < 2) return { hits: [], truncated: false };
  const pattern = escapeRe(q)
    .replace(/\s+/g, "\\s+")
    .replace(/['’‘‚]/g, "['’‘‚]")
    .replace(/["„“”»«]/g, "[\"„“”»«]");
  const re = new RegExp(pattern, "giu");
  const hits: SearchHit[] = [];
  for (const [chapterIndex, chapter] of book.chapters.entries()) {
    for (const block of chapter.blocks) {
      for (const m of block.text.matchAll(re)) {
        if (hits.length >= limit) return { hits, truncated: true };
        hits.push({ chapterIndex, block: block.id, start: m.index, end: m.index + m[0].length });
      }
    }
  }
  return { hits, truncated: false };
}

/** Ausschnitt um einen Treffer, auf Wortgrenzen gekürzt. */
export function hitContext(text: string, start: number, end: number, radius = 48): { before: string; match: string; after: string } {
  let a = Math.max(0, start - radius);
  let z = Math.min(text.length, end + radius);
  if (a > 0) {
    const sp = text.indexOf(" ", a);
    if (sp !== -1 && sp < start) a = sp + 1;
  }
  if (z < text.length) {
    const sp = text.lastIndexOf(" ", z);
    if (sp > end) z = sp;
  }
  return {
    before: (a > 0 ? "…" : "") + text.slice(a, start),
    match: text.slice(start, end),
    after: text.slice(end, z) + (z < text.length ? "…" : ""),
  };
}

export interface SentenceTarget {
  chapterIndex: number;
  block: string;
  sentence: number;
}

/**
 * Nächster (dir = 1) bzw. vorheriger Satz, in dem eine *andere* Redepassage der Figur
 * beginnt oder weiterläuft – über Kapitelgrenzen hinweg. Zum Einsprechen einer Stimme am Stück.
 */
export function findSpeechSentence(
  book: Book,
  byBlock: Map<string, Annotation[]>,
  from: SentenceTarget,
  dir: 1 | -1,
  speaker: string,
): SentenceTarget | null {
  const speechesIn = (block: string, start: number, end: number) =>
    (byBlock.get(block) ?? []).filter((a) => a.type === "speech" && a.speaker === speaker && a.start < end && a.end > start)
      .map((a) => a.id);

  const startList = chapterSentences(book.chapters[from.chapterIndex]!);
  const fromIdx = startList.findIndex((s) => s.block === from.block && s.sentence === from.sentence);
  const here = fromIdx >= 0 ? new Set(speechesIn(from.block, startList[fromIdx]!.start, startList[fromIdx]!.end)) : new Set<string>();

  for (let ci = from.chapterIndex; ci >= 0 && ci < book.chapters.length; ci += dir) {
    const list = ci === from.chapterIndex ? startList : chapterSentences(book.chapters[ci]!);
    let i = ci === from.chapterIndex ? (fromIdx >= 0 ? fromIdx + dir : dir === 1 ? 0 : list.length - 1) : dir === 1 ? 0 : list.length - 1;
    for (; i >= 0 && i < list.length; i += dir) {
      const s = list[i]!;
      const ids = speechesIn(s.block, s.start, s.end);
      if (ids.some((id) => !here.has(id))) {
        // Rückwärts am Anfang der Passage landen, nicht an ihrem letzten Satz
        if (dir === -1) {
          const target = new Set(ids.filter((id) => !here.has(id)));
          while (i > 0 && speechesIn(list[i - 1]!.block, list[i - 1]!.start, list[i - 1]!.end).some((id) => target.has(id))) i--;
        }
        const t = list[i]!;
        return { chapterIndex: ci, block: t.block, sentence: t.sentence };
      }
    }
  }
  return null;
}
