/**
 * KI in der App: Einstellungen (pro Gerät), Einwilligung pro Buch und laufende Aufträge.
 *
 * Der Schlüssel steht nie hier – nur, welcher Anbieter mit welchem Modell gewählt ist.
 */
import {
  castMergeJob, configFromPreset, costOf, estimateJobs, estimateSeconds, estimateTokens, hostOf, isLocalUrl, LlmClient, LlmError,
  migrateConfig, presetById, pronunciationJob, runJobs, speakerChunkChars, speakerJobs, updateSpeed, type Book, type LlmJob,
  type MergeSuggestion, type ProviderConfig, type RunSummary, type SpeakerJobOptions, type SpeakerJobResult, type SpeedProfile,
  type Timing,
} from "@sprechbuch/core";
import type { Platform } from "../platform";
import type { BookSession } from "./session.svelte";

const KEY = "sprechbuch:ai";

interface StoredAi {
  config: ProviderConfig | null;
  maxCostUsd: number;
  /** Buch-ID → Host, für den die Einwilligung gilt */
  consents: Record<string, string>;
  /** gemessene Geschwindigkeit je „Adresse|Modell“ – für die Zeitschätzung lokaler Modelle */
  speeds: Record<string, SpeedProfile>;
}

function load(): StoredAi {
  const fallback: StoredAi = { config: null, maxCostUsd: 5, consents: {}, speeds: {} };
  try {
    const stored = { ...fallback, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") } as StoredAi;
    return { ...stored, config: stored.config ? migrateConfig(stored.config) : null };
  } catch {
    return fallback;
  }
}

export const aiSettings: StoredAi = $state(load());

$effect.root(() => {
  $effect(() => {
    const snapshot = JSON.stringify(aiSettings);
    try {
      localStorage.setItem(KEY, snapshot);
    } catch {
      /* nur für diese Sitzung */
    }
  });
});

/** Vertraulichkeit zuerst: vorgeschlagen wird ein lokales Modell */
export const defaultConfig = () => configFromPreset(presetById("ollama")!);

/** Einrichtungsdialog – von überall aufrufbar */
export const aiDialog = $state({ open: false });

/**
 * „Nur lokale KI“ – der Stand kommt aus der Plattform (Desktop: Rust, das ihn auch durchsetzt).
 * Bis er geladen ist, gilt „nur lokal“.
 */
export const aiPolicy = $state({ allowCloud: false, loaded: false });

export async function refreshPolicy(platform: Platform): Promise<void> {
  aiPolicy.allowCloud = await platform.ai.allowCloud().catch(() => false);
  aiPolicy.loaded = true;
}

export async function setAllowCloud(platform: Platform, allow: boolean): Promise<boolean> {
  aiPolicy.allowCloud = await platform.ai.setAllowCloud(allow);
  return aiPolicy.allowCloud;
}

/** Läuft der Anbieter auf diesem Rechner bzw. im lokalen Netz? */
export const isLocal = (config: ProviderConfig) => isLocalUrl(config.baseUrl);

/** Gesperrt, weil Cloud-KI auf diesem Gerät nicht erlaubt ist */
export const blockedByPolicy = (config: ProviderConfig | null) => !!config && !isLocal(config) && !aiPolicy.allowCloud;

const speedKey = (config: ProviderConfig) => `${config.baseUrl}|${config.model}`;

export const speedFor = (config: ProviderConfig): SpeedProfile | null => aiSettings.speeds[speedKey(config)] ?? null;

export function recordSpeed(config: ProviderConfig, timing: Timing | undefined): void {
  const next = updateSpeed(speedFor(config), timing);
  if (next) aiSettings.speeds[speedKey(config)] = next;
}

/** „ca. 1 Std. 20 Min.“ */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return "unter 1 Min.";
  const min = Math.round(seconds / 60);
  if (min < 60) return `ca. ${min} Min.`;
  const h = Math.floor(min / 60);
  const rest = Math.round((min - h * 60) / 5) * 5;
  return `ca. ${h} Std.${rest ? ` ${rest} Min.` : ""}`;
}

/** Lokale Modelle: Abschnitte passend zum Kontextfenster */
export function jobOptions(book: Book, config: ProviderConfig, opts: SpeakerJobOptions): SpeakerJobOptions {
  return config.contextTokens && isLocal(config) ? { ...opts, maxChars: speakerChunkChars(book, config.contextTokens) } : opts;
}

/** Hat der Mensch für dieses Buch zugestimmt, dass Text an genau diesen Anbieter geht? */
export const hasConsent = (bookId: string, config: ProviderConfig | null) =>
  !!config && aiSettings.consents[bookId] === hostOf(config.baseUrl);

export function setConsent(bookId: string, config: ProviderConfig, value: boolean): void {
  if (value) aiSettings.consents[bookId] = hostOf(config.baseUrl);
  else delete aiSettings.consents[bookId];
}

export type AiTask = "speakers" | "cast" | "pronunciation";

export interface SpeakerOutcome {
  asked: number;
  confirmed: number;
  changed: number;
  review: number;
  newFigures: number;
}

/** Wie haben sich die Redeteile nach dem Einarbeiten entwickelt? */
export function speakerOutcome(before: Book, after: Book, ids: string[]): SpeakerOutcome {
  const prev = new Map(before.annotations.map((a) => [a.id, a]));
  const now = new Map(after.annotations.map((a) => [a.id, a]));
  const out: SpeakerOutcome = { asked: ids.length, confirmed: 0, changed: 0, review: 0, newFigures: after.cast.length - before.cast.length };
  for (const id of ids) {
    const a = now.get(id);
    const b = prev.get(id);
    if (a?.type !== "speech" || b?.type !== "speech") continue;
    if (a.suggestion && a.confidence < 0.5 && a.origin !== "user") out.review++;
    else if (a.speaker !== b.speaker) out.changed++;
    else if (a.origin === "llm") out.confirmed++;
  }
  return out;
}

/** Ein KI-Lauf für eine geöffnete Sitzung */
export class AiRun {
  task: AiTask | null = $state(null);
  status: "idle" | "running" | "done" | "error" = $state("idle");
  total = $state(0);
  done = $state(0);
  active: string[] = $state([]);
  costUsd = $state(0);
  summary: RunSummary | null = $state.raw(null);
  outcome: SpeakerOutcome | null = $state.raw(null);
  merges: MergeSuggestion[] = $state.raw([]);
  pronunciations = $state(0);
  error = $state("");
  /** voraussichtliches Ende (ms seit 1970), sobald schätzbar */
  finishAt: number | null = $state(null);
  #controller: AbortController | null = null;
  readonly session: BookSession;

  constructor(session: BookSession) {
    this.session = session;
  }

  get running(): boolean {
    return this.status === "running";
  }

  client(config: ProviderConfig): LlmClient {
    return new LlmClient(config, this.session.platform.ai.transport);
  }

  jobsFor(task: AiTask, book: Book, config: ProviderConfig, opts: SpeakerJobOptions): LlmJob<unknown>[] {
    if (task === "speakers") return speakerJobs(book, jobOptions(book, config, opts));
    const job = task === "cast" ? castMergeJob(book) : pronunciationJob(book);
    return job ? [job as LlmJob<unknown>] : [];
  }

  /** Anfragen, Token, Kosten – bei gemessener Geschwindigkeit auch die Dauer in Sekunden */
  estimate(task: AiTask, config: ProviderConfig, opts: SpeakerJobOptions = {}) {
    const jobs = this.jobsFor(task, this.session.book, config, opts);
    const speed = isLocal(config) ? speedFor(config) : null;
    return { ...estimateJobs(jobs, config), seconds: speed && jobs.length ? estimateSeconds(jobs, speed) : null };
  }

  cancel(): void {
    this.#controller?.abort();
  }

  async start(task: AiTask, config: ProviderConfig, opts: SpeakerJobOptions = {}, maxCostUsd = aiSettings.maxCostUsd): Promise<void> {
    if (this.running) return;
    const session = this.session;
    const jobs = this.jobsFor(task, session.book, config, opts);
    Object.assign(this, { task, status: "running", total: jobs.length, done: 0, active: [], costUsd: 0, summary: null, outcome: null, error: "", finishAt: null });
    if (task === "cast") this.merges = [];
    if (task === "pronunciation") this.pronunciations = 0;
    this.#controller = new AbortController();

    // Zeitschätzung: mit gemessener Geschwindigkeit, sonst aus dem Verhältnis erledigt/übrig
    const local = isLocal(config);
    const started = Date.now();
    const open = new Set(jobs);
    const running = new Map<LlmJob<unknown>, number>();
    const weight = (list: Iterable<LlmJob<unknown>>) => {
      let w = 0;
      for (const j of list) w += estimateTokens(j.request.system) + estimateTokens(j.request.user) + 5 * j.expectedOutput;
      return w;
    };
    const total = weight(jobs);
    const updateEta = () => {
      const speed = local ? speedFor(config) : null;
      if (speed) {
        const inFlight = [...running.values()].reduce((s, t) => s + (Date.now() - t), 0);
        this.finishAt = Date.now() + Math.max(0, estimateSeconds([...open], speed) * 1000 - inFlight);
      } else {
        const remaining = weight(open);
        this.finishAt = remaining < total ? started + ((Date.now() - started) * total) / (total - remaining) : null;
      }
    };
    updateEta();

    const before = session.book;
    const asked: string[] = [];
    try {
      const client = this.client(config);
      this.summary = await runJobs<unknown>(client, jobs, {
        signal: this.#controller.signal,
        maxCostUsd,
        onStart: (job) => {
          this.active = [...this.active, job.label];
          running.set(job, Date.now());
        },
        onResult: (job, result, usage, timing) => {
          this.active = this.active.filter((l) => l !== job.label);
          this.done++;
          this.costUsd += costOf(usage, config);
          running.delete(job);
          open.delete(job);
          if (local) recordSpeed(config, timing);
          updateEta();
          if (task === "speakers") {
            const r = result as SpeakerJobResult;
            asked.push(...r.items.map((i) => i.id));
            // Kapitelweise einarbeiten: ein Rückgängig-Schritt je Kapitel, ein Abbruch verliert nichts
            if (r.items.length) session.apply({ type: "applySpeakerSuggestions", model: config.model, items: r.items });
            this.outcome = speakerOutcome(before, session.book, asked);
          } else if (task === "pronunciation") {
            const items = result as { term: string; hint: string; ipa?: string }[];
            if (items.length) session.apply({ type: "applyPronunciationSuggestions", model: config.model, items });
            this.pronunciations = items.length;
          } else {
            this.merges = result as MergeSuggestion[];
          }
        },
        onError: (job) => {
          this.active = this.active.filter((l) => l !== job.label);
          running.delete(job);
          open.delete(job);
          updateEta();
        },
      });
      this.status = this.summary.done || !this.summary.failed ? "done" : "error";
      if (this.status === "error") this.error = this.summary.errors[0]?.message ?? "Fehlgeschlagen";
    } catch (err) {
      this.status = "error";
      this.error = err instanceof LlmError || err instanceof Error ? err.message : String(err);
    } finally {
      this.active = [];
      this.finishAt = null;
      this.#controller = null;
    }
  }
}

const runs = new WeakMap<BookSession, AiRun>();

export function aiRunFor(session: BookSession): AiRun {
  let run = runs.get(session);
  if (!run) runs.set(session, (run = new AiRun(session)));
  return run;
}
