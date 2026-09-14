/**
 * Qualität messen: Ein vollständig geprüftes Buch ist ein Testsatz. Die Nutzerentscheidungen
 * darin gelten als richtig; verglichen wird eine Fassung nur mit Regeln bzw. Regeln + KI.
 *
 * Die Fassungen dürfen unterschiedlich importiert sein (andere Kapitelauswahl, andere Block-IDs):
 * Absätze werden über ihren Text einander zugeordnet.
 *
 * Die wichtigste Zahl ist `silentWrong`: falsch zugeordnet und trotzdem *nicht* in der Prüfung –
 * genau diese Fehler liest die Sprecherin sonst ab.
 */
import type { Book, SpeechAnnotation } from "../book/schema.js";
import { needsReview } from "../edit/lookup.js";

export interface SpeakerAccuracy {
  /** Redeteile mit Nutzerentscheidung im Referenzbuch */
  reference: number;
  /** davon in der Kandidatenfassung als Rede gefunden */
  found: number;
  correct: number;
  wrong: number;
  /** ohne Figur */
  unattributed: number;
  /** in der Prüf-Warteschlange (egal ob richtig oder falsch) */
  queued: number;
  /** falsch, aber nicht zur Prüfung vorgesehen */
  silentWrong: number;
}

const overlap = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

function nameIndex(book: Book): Map<string, string> {
  const idx = new Map<string, string>();
  for (const c of book.cast) {
    for (const n of [c.name, ...c.aliases]) idx.set(n.toLowerCase(), c.id);
  }
  return idx;
}

/** Kandidaten-Block → Referenz-Block, über gleichen Text (bei Wiederholungen in Reihenfolge) */
export function alignBlocks(reference: Book, candidate: Book): Map<string, string> {
  const key = (t: string) => t.replace(/\s+/g, " ").trim();
  const refByText = new Map<string, string[]>();
  for (const ch of reference.chapters) {
    for (const b of ch.blocks) {
      const list = refByText.get(key(b.text)) ?? [];
      list.push(b.id);
      refByText.set(key(b.text), list);
    }
  }
  const used = new Map<string, number>();
  const out = new Map<string, string>();
  for (const ch of candidate.chapters) {
    for (const b of ch.blocks) {
      const k = key(b.text);
      const list = refByText.get(k);
      const i = used.get(k) ?? 0;
      if (list?.[i]) out.set(b.id, list[i]);
      used.set(k, i + 1);
    }
  }
  return out;
}

export function compareSpeakers(reference: Book, candidate: Book): SpeakerAccuracy {
  const refIds = new Set(reference.cast.map((c) => c.id));
  const refNames = nameIndex(reference);
  const candCast = new Map(candidate.cast.map((c) => [c.id, c]));
  /** Kandidaten-Figur → Referenz-Figur (gleiche ID oder über Name/Alias) */
  const mapSpeaker = (id: string | null): string | null => {
    if (!id) return null;
    const c = candCast.get(id);
    for (const n of c ? [c.name, ...c.aliases] : []) {
      const hit = refNames.get(n.toLowerCase());
      if (hit) return hit;
    }
    return refIds.has(id) ? id : `?${id}`;
  };

  const aligned = alignBlocks(reference, candidate);
  const candByBlock = new Map<string, SpeechAnnotation[]>();
  for (const a of candidate.annotations) {
    const refBlock = aligned.get(a.block);
    if (a.type !== "speech" || !refBlock) continue;
    const list = candByBlock.get(refBlock) ?? [];
    list.push(a);
    candByBlock.set(refBlock, list);
  }

  const r: SpeakerAccuracy = { reference: 0, found: 0, correct: 0, wrong: 0, unattributed: 0, queued: 0, silentWrong: 0 };
  for (const ref of reference.annotations) {
    if (ref.type !== "speech" || ref.origin !== "user" || !ref.speaker) continue;
    r.reference++;
    const best = (candByBlock.get(ref.block) ?? [])
      .map((c) => ({ c, o: overlap(c, ref) }))
      .sort((x, y) => y.o - x.o)[0];
    if (!best || best.o < (ref.end - ref.start) / 2) continue;
    r.found++;
    const queued = needsReview(best.c);
    if (queued) r.queued++;
    const speaker = mapSpeaker(best.c.speaker);
    if (!speaker) r.unattributed++;
    else if (speaker === ref.speaker) r.correct++;
    else {
      r.wrong++;
      if (!queued) r.silentWrong++;
    }
  }
  return r;
}
