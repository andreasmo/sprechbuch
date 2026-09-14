/**
 * Gemeinsame Bausteine der KI-Aufgaben: ein Auftrag = eine Anfrage mit Auswertung.
 */
import type { CompletionRequest } from "./client.js";

export interface LlmJob<T> {
  /** eindeutig innerhalb eines Laufs */
  key: string;
  /** für Fortschritt und Fehlermeldungen, z. B. „Kapitel 3“ */
  label: string;
  chapterIndex?: number;
  request: CompletionRequest;
  /** erwartete Ausgabetoken – für die Kostenschätzung */
  expectedOutput: number;
  parse(json: unknown): T;
}

/** Grobe Tokenschätzung für deutschen Text (neuere Tokenizer: eher mehr Token) */
export const estimateTokens = (text: string) => Math.ceil(text.length / 3);

export function estimateJobs(jobs: readonly LlmJob<unknown>[], price: { priceIn: number; priceOut: number }) {
  let input = 0;
  let output = 0;
  for (const j of jobs) {
    input += estimateTokens(j.request.system) + estimateTokens(j.request.user);
    output += j.expectedOutput;
  }
  return { requests: jobs.length, input, output, costUsd: (input * price.priceIn + output * price.priceOut) / 1_000_000 };
}

export const objectSchema = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

export const arrayOf = (items: Record<string, unknown>) => ({ type: "array", items: objectSchema(items) });

export const clip = (t: string, max: number) => {
  const s = t.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
};

/** Manche Modelle antworten in Prozent */
export const normalizeConfidence = (c: number) => Math.min(1, Math.max(0, c > 1 && c <= 100 ? c / 100 : c));

export const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});
export const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const asString = (v: unknown): string => (typeof v === "string" ? v : "");
export const asNumber = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
