/**
 * Gemeinsame Bausteine der KI-Aufgaben: ein Auftrag = eine Anfrage mit Auswertung.
 */
import type { CompletionRequest, Timing } from "./client.js";

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

/** Gemessene Geschwindigkeit eines Modells auf diesem Rechner, in Token pro Sekunde */
export interface SpeedProfile {
  promptTps: number;
  outputTps: number;
  /** wie viele Token in die Messung eingeflossen sind – je mehr, desto träger ändert sie sich */
  samples: number;
}

/** Messung aus einer Antwort in das Profil einrechnen; null, wenn die Antwort keine Zeiten trägt */
export function updateSpeed(profile: SpeedProfile | null | undefined, timing: Timing | undefined): SpeedProfile | null {
  if (!timing?.promptMs || !timing.outputMs || !timing.promptTokens || !timing.outputTokens) return profile ?? null;
  const prompt = timing.promptTokens / (timing.promptMs / 1000);
  const output = timing.outputTokens / (timing.outputMs / 1000);
  const weight = timing.promptTokens + timing.outputTokens;
  if (!profile) return { promptTps: prompt, outputTps: output, samples: weight };
  // Lange Abschnitte zählen mehr als die kurze Probeanfrage; alte Messungen verblassen langsam
  const old = Math.min(profile.samples, 200_000);
  const mix = (a: number, b: number) => (a * old + b * weight) / (old + weight);
  return { promptTps: mix(profile.promptTps, prompt), outputTps: mix(profile.outputTps, output), samples: old + weight };
}

/** Voraussichtliche Dauer in Sekunden (ohne Ladezeit des Modells) */
export function estimateSeconds(jobs: readonly LlmJob<unknown>[], speed: SpeedProfile): number {
  const { input, output } = estimateJobs(jobs, { priceIn: 0, priceOut: 0 });
  return input / speed.promptTps + output / speed.outputTps;
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
