/**
 * KI-Aufgabe 3: Aussprachevorschläge für Namen und Fremdwörter.
 * Eingetragen werden sie als „KI, ungeprüft“ – geklärt ist ein Wort erst, wenn der Mensch es abhakt.
 */
import type { Book } from "../book/schema.js";
import type { PronunciationSuggestion } from "../edit/edits.js";
import { arrayOf, asArray, asRecord, asString, clip, objectSchema, type LlmJob } from "./jobs.js";

const MAX_TERMS = 200;

const SYSTEM = `Du bist Sprechtrainerin für Hörbuchproduktionen. Für Namen und schwierige Wörter aus einem Buch soll eine Sprecherin sehen, wie sie ausgesprochen werden.

Für jedes Wort:
- hint: Aussprache in einfacher deutscher Umschrift, Silben mit Bindestrich, die betonte Silbe in GROSSBUCHSTABEN, z. B. „Ko-ba-LA-ba“ oder „ZHO-zeh“. Wird das Wort ganz normal deutsch ausgesprochen, gib hint leer zurück.
- ipa: Lautschrift (IPA) ohne Schrägstriche, oder leer, wenn du unsicher bist.
- Nutze den Satz aus dem Buch, um Herkunft und Sprache einzuschätzen. Bei erfundenen Namen: die naheliegende Lesart für deutsches Publikum.
- Gib jedes Wort genau einmal zurück, mit exakt der Schreibweise aus der Liste in term.`;

const SCHEMA = objectSchema({
  items: arrayOf({ term: { type: "string" }, hint: { type: "string" }, ipa: { type: "string" } }),
});

/** Erster Satzausschnitt, in dem das Wort vorkommt */
function contextOf(book: Book, term: string): string {
  for (const ch of book.chapters) {
    for (const b of ch.blocks) {
      const i = b.text.indexOf(term);
      if (i < 0) continue;
      const from = Math.max(0, i - 70);
      return clip(`${from > 0 ? "…" : ""}${b.text.slice(from, i + term.length + 70)}`, 170);
    }
  }
  return "";
}

/** Wörter, die noch einen Vorschlag brauchen */
export const openPronunciations = (book: Book, recheck = false) =>
  book.pronunciations.filter((p) => !p.verified && p.origin !== "user" && (recheck || (!p.hint && p.origin !== "llm")));

export function pronunciationJob(book: Book, opts: { recheck?: boolean } = {}): LlmJob<PronunciationSuggestion[]> | null {
  const terms = openPronunciations(book, opts.recheck)
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_TERMS);
  if (!terms.length) return null;
  const list = terms.map((p) => `- ${p.term} (${p.count}×): ${contextOf(book, p.term)}`).join("\n");
  const known = new Set(terms.map((t) => t.term));
  return {
    key: "pronunciation",
    label: "Aussprache",
    request: {
      system: SYSTEM,
      user: `Buch: „${book.meta.title}“${book.meta.language ? ` (Sprache: ${book.meta.language})` : ""}\n\nWörter mit einem Satz aus dem Buch:\n${list}`,
      schema: SCHEMA,
      schemaName: "aussprache",
      maxTokens: Math.min(16_000, 300 + terms.length * 60),
    },
    expectedOutput: 30 + terms.length * 30,
    parse(json) {
      const out: PronunciationSuggestion[] = [];
      for (const raw of asArray(asRecord(json).items)) {
        const r = asRecord(raw);
        const term = asString(r.term).trim();
        const hint = asString(r.hint).trim();
        if (!known.has(term) || !hint) continue;
        out.push({ term, hint: clip(hint, 60), ...(asString(r.ipa).trim() ? { ipa: clip(asString(r.ipa).replace(/^\/|\/$/g, ""), 60) } : {}) });
      }
      return out;
    },
  };
}
