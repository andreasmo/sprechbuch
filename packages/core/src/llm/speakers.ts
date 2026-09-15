/**
 * KI-Aufgabe 1: Wer spricht? Kapitelweise, mit dem ganzen Kapitel als Kontext.
 *
 * Nur wo die Regeln unsicher sind, wird gefragt. Sichere Zuordnungen stehen als Orientierung
 * im Text – so kann das Modell Wechselreden verfolgen, ohne dafür bezahlt zu werden.
 */
import type { Book, BookChapter, CastEntry, SpeechAnnotation } from "../book/schema.js";
import type { SpeakerSuggestion } from "../edit/edits.js";
import { buildLookup, type BookLookup } from "../edit/lookup.js";
import { contextTokensOf } from "./client.js";
import { arrayOf, asArray, asNumber, asRecord, asString, clip, estimateTokens, normalizeConfidence, objectSchema, type LlmJob } from "./jobs.js";

/** Ab hier gilt eine Zuordnung als sicher und wird nicht gefragt */
export const SURE_CONFIDENCE = 0.9;
/** Kapitel darüber werden in Teile zerlegt */
const MAX_CHARS = 60_000;
const MIN_CHARS = 6_000;
const CONTEXT_BLOCKS = 3;

export interface SpeakerJobOptions {
  /** Kapitelindizes; Standard: alle */
  chapters?: number[];
  /** auch sichere Regel-Zuordnungen prüfen */
  includeSure?: boolean;
  /** auch schon von der KI geprüfte Redeteile erneut fragen */
  recheck?: boolean;
  /** höchstens so viele Zeichen Kapiteltext je Anfrage (Standard 60 000) – siehe `speakerChunkChars` */
  maxChars?: number;
}

const SYSTEM = `Du hilfst bei der Vorbereitung eines Hörbuchs. Für jede markierte Redepassage soll feststehen, welche Figur spricht – danach wählt die Sprecherin die Stimme.

Im Kapiteltext sind Redepassagen so markiert:
- ⟦R12⟧»…«⟦/R12⟧ – Sprecher ist zu bestimmen
- ⟦Name⟧»…«⟦/⟧ – Sprecher steht schon fest; nutze das zur Orientierung, etwa bei Wechselreden

Regeln:
- Bestimme für jede Passage R… die sprechende Figur und gib ihre ID aus der Figurenliste als speaker an.
- Achte auf Inquit-Formeln („sagte er“), Anreden, den Wechsel der Sprecher im Gespräch, Pronomen und den Zusammenhang über Absatzgrenzen hinweg. Wer angeredet wird, spricht in der Regel nicht selbst.
- Spricht eine Figur, die nicht in der Liste steht: speaker leer lassen und den Namen oder eine kurze Bezeichnung („der Bootsführer“) als newFigure angeben.
- Ist die Stelle keine gesprochene Äußerung einer Figur (Titel, Aufschrift, einzelnes zitiertes Wort, Brieftext), setze notSpeech auf true.
- confidence von 0 bis 1: Wie sicher bist du? Unter 0.6, wenn mehrere Figuren plausibel sind.
- note: Begründung in höchstens acht Wörtern, z. B. „Anrede Sandi → Sanders“.
- Gib jede Passage R… genau einmal zurück.`;

const SCHEMA = objectSchema({
  items: arrayOf({
    id: { type: "string" },
    speaker: { type: "string" },
    newFigure: { type: "string" },
    notSpeech: { type: "boolean" },
    confidence: { type: "number" },
    note: { type: "string" },
  }),
});

const GENDER: Record<string, string> = { m: "männlich", f: "weiblich" };

export function castListText(cast: readonly CastEntry[]): string {
  return cast.map((c) => {
    const extra = [GENDER[c.gender], c.aliases.length ? `auch: ${c.aliases.join(", ")}` : "", c.voiceNote ? `Stimme: ${c.voiceNote}` : ""]
      .filter(Boolean).join("; ");
    return `- ${c.id}: ${c.name}${extra ? ` (${extra})` : ""}`;
  }).join("\n");
}

/**
 * Wird dieser Redeteil gefragt? Schon von der KI eingeschätzte (übernommen, bestätigt oder mit
 * KI-Vorschlag) nur mit `recheck` – so setzt ein neuer Lauf nach einem Abbruch dort fort.
 */
const isAsked = (a: SpeechAnnotation, opts: SpeakerJobOptions) =>
  a.origin !== "user"
  && (opts.recheck || (a.origin !== "llm" && a.suggestion?.source !== "llm"))
  && (opts.includeSure || a.speaker === null || a.confidence < SURE_CONFIDENCE);

/**
 * Wie viel Kapiteltext passt bei einem Kontextfenster von `contextTokens` in eine Anfrage? Gut die
 * Hälfte des Fensters für die Eingabe (Anweisung, Figurenliste, Text), der Rest bleibt der Antwort.
 */
export function speakerChunkChars(book: Book, contextTokens: number): number {
  const overhead = contextTokensOf(SYSTEM) + contextTokensOf(castListText(book.cast)) + 400;
  const budget = contextTokens * 0.6 - overhead;
  return Math.max(MIN_CHARS, Math.min(MAX_CHARS, Math.floor(budget * 2.6)));
}

interface RenderedPart {
  text: string;
  ids: Map<string, string>;
}

/** Blöcke als Text mit Markierungen; `numbering` zählt kapitelweit weiter */
function renderBlocks(
  blocks: BookChapter["blocks"], lookup: BookLookup, opts: SpeakerJobOptions, askFrom: number, counter: { n: number },
): RenderedPart {
  const ids = new Map<string, string>();
  const lines: string[] = [];
  blocks.forEach((b, i) => {
    if (b.type === "h1" || b.type === "h2") {
      lines.push(`${b.type === "h1" ? "#" : "##"} ${b.text}`);
      return;
    }
    const speeches = (lookup.byBlock.get(b.id) ?? []).filter((a): a is SpeechAnnotation => a.type === "speech")
      .sort((x, y) => x.start - y.start);
    let out = "";
    let pos = 0;
    for (const a of speeches) {
      if (a.start < pos) continue;
      out += b.text.slice(pos, a.start);
      const inner = b.text.slice(a.start, a.end);
      if (i >= askFrom && isAsked(a, opts)) {
        const key = `R${++counter.n}`;
        ids.set(key, a.id);
        out += `⟦${key}⟧${inner}⟦/${key}⟧`;
      } else if (a.speaker) {
        const name = lookup.cast.get(a.speaker)?.name ?? a.speaker;
        out += `⟦${name}⟧${inner}⟦/⟧`;
      } else {
        out += inner;
      }
      pos = a.end;
    }
    out += b.text.slice(pos);
    lines.push(out);
  });
  return { text: lines.join("\n\n"), ids };
}

export interface SpeakerJobResult {
  chapterIndex: number;
  items: SpeakerSuggestion[];
  /** gefragte Redeteile ohne verwertbare Antwort */
  missing: number;
}

export function speakerJobs(book: Book, opts: SpeakerJobOptions = {}, lookup = buildLookup(book)): LlmJob<SpeakerJobResult>[] {
  const jobs: LlmJob<SpeakerJobResult>[] = [];
  const castText = castListText(book.cast);
  const wanted = opts.chapters ? new Set(opts.chapters) : null;
  const maxChars = Math.max(MIN_CHARS, opts.maxChars ?? MAX_CHARS);

  book.chapters.forEach((chapter, chapterIndex) => {
    if (wanted && !wanted.has(chapterIndex)) return;
    // In Teile zerlegen, falls das Kapitel sehr lang ist
    const parts: [number, number][] = [];
    let start = 0;
    let chars = 0;
    chapter.blocks.forEach((b, i) => {
      if (chars + b.text.length > maxChars && i > start) {
        parts.push([start, i]);
        start = i;
        chars = 0;
      }
      chars += b.text.length;
    });
    parts.push([start, chapter.blocks.length]);

    const counter = { n: 0 };
    parts.forEach(([from, to], p) => {
      const ctxFrom = Math.max(0, from - CONTEXT_BLOCKS);
      const { text, ids } = renderBlocks(chapter.blocks.slice(ctxFrom, to), lookup, opts, from - ctxFrom, counter);
      if (!ids.size) return;
      const partLabel = parts.length > 1 ? ` (Teil ${p + 1} von ${parts.length})` : "";
      const user = [
        `Buch: „${book.meta.title}“${book.meta.author ? ` von ${book.meta.author}` : ""}`,
        `Kapitel ${chapterIndex + 1}: ${chapter.title}${partLabel}`,
        "",
        "Figurenliste (ID: Name):",
        castText || "(noch keine Figuren erkannt)",
        "",
        `Zu bestimmen: ${[...ids.keys()].join(", ")} (${ids.size} Passagen)`,
        "",
        from > ctxFrom ? "Kapiteltext (die ersten Absätze nur als Zusammenhang aus dem vorigen Teil):" : "Kapiteltext:",
        text,
      ].join("\n");
      const castIds = new Set(book.cast.map((c) => c.id));
      const byName = new Map<string, string>();
      for (const c of book.cast) for (const n of [c.name, ...c.aliases]) byName.set(n.toLowerCase(), c.id);

      jobs.push({
        key: `speakers:${chapter.id}:${p}`,
        label: `Kapitel ${chapterIndex + 1}${partLabel}`,
        chapterIndex,
        request: { system: SYSTEM, user, schema: SCHEMA, schemaName: "sprecherzuordnung", maxTokens: Math.min(32_000, Math.max(1024, 200 + ids.size * 70)) },
        expectedOutput: 40 + ids.size * 45,
        parse(json) {
          const items: SpeakerSuggestion[] = [];
          const seen = new Set<string>();
          for (const raw of asArray(asRecord(json).items)) {
            const r = asRecord(raw);
            const annotation = ids.get(asString(r.id).trim());
            if (!annotation || seen.has(annotation)) continue;
            seen.add(annotation);
            let speaker: string | null = asString(r.speaker).trim() || null;
            let newFigure = asString(r.newFigure).trim();
            if (speaker && !castIds.has(speaker)) {
              // Name statt ID geliefert?
              const resolved = byName.get(speaker.toLowerCase());
              if (!resolved && !newFigure) newFigure = speaker;
              speaker = resolved ?? null;
            }
            const notSpeech = r.notSpeech === true;
            if (!speaker && !newFigure && !notSpeech) continue;
            items.push({
              id: annotation, speaker, notSpeech, confidence: normalizeConfidence(asNumber(r.confidence, 0.5)),
              ...(newFigure && !speaker ? { newFigure } : {}),
              ...(asString(r.note).trim() ? { note: clip(asString(r.note), 80) } : {}),
            });
          }
          return { chapterIndex, items, missing: ids.size - items.length };
        },
      });
    });
  });
  return jobs;
}

/** Wie viele Redeteile würden gefragt? (für die Vorschau ohne Anfrage) */
export function countAsked(book: Book, opts: SpeakerJobOptions = {}): number {
  const wanted = opts.chapters ? new Set(opts.chapters.map((i) => book.chapters[i]?.id)) : null;
  const lookup = buildLookup(book);
  return book.annotations.filter((a) => a.type === "speech" && isAsked(a, opts)
    && (!wanted || wanted.has(lookup.blocks.get(a.block)?.chapter.id))).length;
}

export { estimateTokens };
