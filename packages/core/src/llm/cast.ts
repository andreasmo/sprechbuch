/**
 * KI-Aufgabe 2: Welche Figureneinträge meinen dieselbe Person?
 * („Bones“ = „Leutnant Tibbetts“, „der Häuptling“ = „Makara“) – genau das, was Regeln nicht können.
 * Die Vorschläge werden nicht automatisch angewendet; jede Zusammenführung bestätigt der Mensch.
 */
import type { Book } from "../book/schema.js";
import { buildLookup } from "../edit/lookup.js";
import { arrayOf, asArray, asNumber, asRecord, asString, clip, normalizeConfidence, objectSchema, type LlmJob } from "./jobs.js";

export interface MergeSuggestion {
  from: string;
  into: string;
  confidence: number;
  reason: string;
}

const MAX_FIGURES = 150;

const SYSTEM = `Du hilfst bei der Vorbereitung eines Hörbuchs. Eine automatische Analyse hat Figuren erkannt – dabei landet dieselbe Person oft unter mehreren Einträgen: Spitzname und Name, Titel oder Rolle („der Kommissar“) und Name, Schreibvarianten.

Finde Einträge, die sicher oder sehr wahrscheinlich dieselbe Person bezeichnen.
- from: ID des Eintrags, der aufgelöst werden soll (meist die Rolle, der Spitzname oder der seltenere Eintrag)
- into: ID des Eintrags, der bleibt (meist der eigentliche Name)
- confidence von 0 bis 1
- reason: kurze Begründung, höchstens zwölf Wörter
Schlage nichts vor, wenn es nur ähnliche Namen verschiedener Personen sind. Keine Ketten: Jeder Eintrag erscheint höchstens einmal als from.`;

const SCHEMA = objectSchema({
  merges: arrayOf({ from: { type: "string" }, into: { type: "string" }, confidence: { type: "number" }, reason: { type: "string" } }),
});

export function castMergeJob(book: Book): LlmJob<MergeSuggestion[]> | null {
  if (book.cast.length < 2) return null;
  const lookup = buildLookup(book);
  const lines = new Map<string, { n: number; chapters: Set<number>; samples: string[] }>();
  for (const a of book.annotations) {
    if (a.type !== "speech" || !a.speaker) continue;
    const ref = lookup.blocks.get(a.block);
    if (!ref) continue;
    const e = lines.get(a.speaker) ?? { n: 0, chapters: new Set<number>(), samples: [] };
    e.n++;
    e.chapters.add(ref.chapterIndex + 1);
    if (e.samples.length < 2) e.samples.push(clip(ref.block.text.slice(a.start, a.end), 110));
    lines.set(a.speaker, e);
  }
  const figures = [...book.cast]
    .sort((x, y) => (lines.get(y.id)?.n ?? 0) - (lines.get(x.id)?.n ?? 0))
    .slice(0, MAX_FIGURES);
  const text = figures.map((c) => {
    const e = lines.get(c.id);
    const chapters = e ? [...e.chapters].sort((a, b) => a - b) : [];
    const where = chapters.length ? `Kap. ${chapters.length > 4 ? `${chapters[0]}–${chapters.at(-1)}` : chapters.join(", ")}` : "spricht nicht";
    const aliases = c.aliases.length ? `; auch: ${c.aliases.join(", ")}` : "";
    const samples = e?.samples.length ? `\n    Beispiel: ${e.samples.join(" | ")}` : "";
    return `- ${c.id}: ${c.name} (${e?.n ?? 0} Redeteile, ${where}${aliases})${samples}`;
  }).join("\n");

  const ids = new Set(figures.map((c) => c.id));
  return {
    key: "cast",
    label: "Figuren",
    request: {
      system: SYSTEM,
      user: `Buch: „${book.meta.title}“${book.meta.author ? ` von ${book.meta.author}` : ""}\n\nFiguren:\n${text}`,
      schema: SCHEMA,
      schemaName: "figuren_zusammenfuehren",
      maxTokens: 4000,
    },
    expectedOutput: 60 + Math.min(40, figures.length) * 25,
    parse(json) {
      const out: MergeSuggestion[] = [];
      const used = new Set<string>();
      for (const raw of asArray(asRecord(json).merges)) {
        const r = asRecord(raw);
        const from = asString(r.from).trim();
        const into = asString(r.into).trim();
        if (!ids.has(from) || !ids.has(into) || from === into || used.has(from)) continue;
        used.add(from);
        out.push({ from, into, confidence: normalizeConfidence(asNumber(r.confidence, 0.5)), reason: clip(asString(r.reason), 120) });
      }
      // Ketten auflösen: a→b, b→c wird zu a→c, b→c
      const target = (id: string, depth = 0): string => {
        const next = out.find((m) => m.from === id);
        return next && depth < 10 ? target(next.into, depth + 1) : id;
      };
      return out.map((m) => ({ ...m, into: target(m.into) })).filter((m) => m.from !== m.into);
    },
  };
}
