/**
 * KI in der App: Einstellungen (pro Gerät), Einwilligung pro Buch und laufende Aufträge.
 *
 * Der Schlüssel steht nie hier – nur, welcher Anbieter mit welchem Modell gewählt ist.
 */
import {
  castMergeJob, configFromPreset, costOf, estimateJobs, hostOf, LlmClient, LlmError, presetById, pronunciationJob, runJobs,
  speakerJobs, type Book, type LlmJob, type MergeSuggestion, type ProviderConfig, type RunSummary, type SpeakerJobOptions,
  type SpeakerJobResult,
} from "@sprechbuch/core";
import type { BookSession } from "./session.svelte";

const KEY = "sprechbuch:ai";

interface StoredAi {
  config: ProviderConfig | null;
  maxCostUsd: number;
  /** Buch-ID → Host, für den die Einwilligung gilt */
  consents: Record<string, string>;
}

function load(): StoredAi {
  const fallback: StoredAi = { config: null, maxCostUsd: 5, consents: {} };
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
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

export const defaultConfig = () => configFromPreset(presetById("anthropic")!);

/** Einrichtungsdialog – von überall aufrufbar */
export const aiDialog = $state({ open: false });

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

  jobsFor(task: AiTask, book: Book, opts: SpeakerJobOptions): LlmJob<unknown>[] {
    if (task === "speakers") return speakerJobs(book, opts);
    const job = task === "cast" ? castMergeJob(book) : pronunciationJob(book);
    return job ? [job as LlmJob<unknown>] : [];
  }

  estimate(task: AiTask, config: ProviderConfig, opts: SpeakerJobOptions = {}) {
    return estimateJobs(this.jobsFor(task, this.session.book, opts), config);
  }

  cancel(): void {
    this.#controller?.abort();
  }

  async start(task: AiTask, config: ProviderConfig, opts: SpeakerJobOptions = {}, maxCostUsd = aiSettings.maxCostUsd): Promise<void> {
    if (this.running) return;
    const session = this.session;
    const jobs = this.jobsFor(task, session.book, opts);
    Object.assign(this, { task, status: "running", total: jobs.length, done: 0, active: [], costUsd: 0, summary: null, outcome: null, error: "" });
    if (task === "cast") this.merges = [];
    if (task === "pronunciation") this.pronunciations = 0;
    this.#controller = new AbortController();

    const before = session.book;
    const asked: string[] = [];
    try {
      const client = this.client(config);
      this.summary = await runJobs<unknown>(client, jobs, {
        signal: this.#controller.signal,
        maxCostUsd,
        onStart: (job) => (this.active = [...this.active, job.label]),
        onResult: (job, result, usage) => {
          this.active = this.active.filter((l) => l !== job.label);
          this.done++;
          this.costUsd += costOf(usage, config);
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
        onError: (job) => (this.active = this.active.filter((l) => l !== job.label)),
      });
      this.status = this.summary.done || !this.summary.failed ? "done" : "error";
      if (this.status === "error") this.error = this.summary.errors[0]?.message ?? "Fehlgeschlagen";
    } catch (err) {
      this.status = "error";
      this.error = err instanceof LlmError || err instanceof Error ? err.message : String(err);
    } finally {
      this.active = [];
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
