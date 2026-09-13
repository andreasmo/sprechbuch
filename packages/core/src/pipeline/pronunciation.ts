/**
 * Aussprache-Kandidaten: Wörter, die vor der Aufnahme geklärt werden sollten.
 *
 * Nicht »alles Großgeschriebene« – das wären im Deutschen sämtliche Substantive.
 * Aufgenommen werden Eigennamen (großgeschrieben, aber selten mit Begleiter
 * davor), auffällig lange Komposita und fremd anmutende Schreibungen.
 */
import { W } from "../text.js";
import { STOP_NAMES } from "./speakers.js";
import type { Doc } from "./types.js";

export type PronunciationKind = "figure" | "name" | "long" | "foreign";

export interface PronunciationCandidate {
  term: string;
  kind: PronunciationKind;
  count: number;
  chapter: string;
  block: number;
  context: string;
}

const TOKEN = new RegExp(`[A-Za-zÄÖÜäöüß][${W}ÄÖÜäöüß\\-']*`, "gu");
const DETERMINER = new RegExp(
  "(?<![\\p{L}\\p{N}_])(?:der|die|das|den|dem|des|ein|eine|einen|einem|einer|eines|im|am|zum|"
  + "zur|vom|beim|ins|aufs|dieser?|diese[nmrs]?|jede[nmrs]?|seine?[nmrs]?|"
  + "ihre?[nmrs]?|mein[\\p{L}\\p{N}_]*|dein[\\p{L}\\p{N}_]*|unser[\\p{L}\\p{N}_]*|kein[\\p{L}\\p{N}_]*|"
  + "viele[nmr]?|alle[nmrs]?|manche[nmrs]?|solche[nmrs]?|the|a|an|his|her|their|my|your)\\s+"
  + "(?:[a-zäöüß]+\\s+){0,2}$", "iu");
const NOT_A_NAME = new Set(["sie", "ihnen", "ihr", "ihre", "ich", "er", "es", "wir", "du", "man",
  "ja", "nein", "ach", "oh", "und", "aber", "denn", "doch", "nun",
  "the", "you", "they", "we", "he", "she", "it", "and", "but", ...STOP_NAMES]);
/** Bewusst ohne w/y – die sind im Deutschen alltäglich. */
const FOREIGN = /(?:['’]|ph|rh|eau|oe|ae|[qx]|zh|kh|cz|sz|gh|[àáâãçèéêëìíîïñòóôõùúûý])/iu;

export function pronunciationCandidates(doc: Doc, top = 300): PronunciationCandidate[] {
  const names = new Set((doc.cast ?? []).filter((c) => c.lines).map((c) => c.name.toLowerCase()));
  const freq = new Map<string, number>();
  const det = new Map<string, number>();
  const first = new Map<string, Omit<PronunciationCandidate, "term" | "kind" | "count">>();

  doc.chapters.forEach((ch) => {
    ch.blocks.forEach((b, bi) => {
      if (b.type === "h1" || b.type === "h2") return;
      for (const [a, z] of b.sent ?? []) {
        const s = b.text.slice(a, z);
        for (const m of s.matchAll(TOKEN)) {
          const w = m[0];
          if (w.length < 3 || NOT_A_NAME.has(w.toLowerCase())) continue;
          const cap = /^\p{Lu}/u.test(w) && m.index! > 1;
          if (!(cap || w.length >= 16 || names.has(w.toLowerCase()) || (FOREIGN.test(w) && w !== w.toLowerCase()))) continue;
          freq.set(w, (freq.get(w) ?? 0) + 1);
          if (cap && DETERMINER.test(s.slice(0, m.index))) det.set(w, (det.get(w) ?? 0) + 1);
          if (!first.has(w)) first.set(w, { chapter: ch.id, block: bi, context: s.trim().slice(0, 130) });
        }
      }
    });
  });

  const out: PronunciationCandidate[] = [];
  const sorted = [...freq.entries()].sort((x, y) => y[1] - x[1]);
  for (const [term, count] of sorted) {
    const nameLike = /^\p{Lu}/u.test(term) && (det.get(term) ?? 0) / count < 0.12;
    let kind: PronunciationKind;
    if (names.has(term.toLowerCase()) && nameLike) kind = "figure";
    else if (nameLike) kind = "name";
    else if (term.length >= 16) kind = "long";
    else if (FOREIGN.test(term) && term !== term.toLowerCase()) kind = "foreign";
    else continue;
    out.push({ term, kind, count, ...first.get(term)! });
    if (out.length >= top) break;
  }
  return out;
}
