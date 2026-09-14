/**
 * Aufträge abarbeiten: parallel bis zur eingestellten Grenze, mit Kostenobergrenze und Abbruch.
 * Ergebnisse kommen einzeln zurück, sobald sie da sind – die App arbeitet sie kapitelweise ein,
 * damit ein Abbruch nichts verliert.
 */
import { costOf, LlmError, type LlmClient, type Usage } from "./client.js";
import { estimateTokens, type LlmJob } from "./jobs.js";

export interface RunOptions<T> {
  signal?: AbortSignal;
  /** Überschreibt die Parallelität aus der Konfiguration */
  concurrency?: number;
  /** Startet keinen weiteren Auftrag, wenn die Kosten (bisher + geschätzt) darüber lägen */
  maxCostUsd?: number;
  onStart?(job: LlmJob<T>): void;
  onResult?(job: LlmJob<T>, result: T, usage: Usage): void;
  onError?(job: LlmJob<T>, error: LlmError): void;
}

export interface RunSummary {
  done: number;
  failed: number;
  skipped: number;
  usage: Usage;
  costUsd: number;
  stopped: "aborted" | "cost" | "auth" | null;
  errors: { label: string; message: string }[];
}

export async function runJobs<T>(client: LlmClient, jobs: readonly LlmJob<T>[], opts: RunOptions<T> = {}): Promise<RunSummary> {
  const summary: RunSummary = { done: 0, failed: 0, skipped: 0, usage: { input: 0, output: 0 }, costUsd: 0, stopped: null, errors: [] };
  const queue = [...jobs];
  const limit = Math.max(1, opts.concurrency ?? client.config.concurrency);

  const estimate = (job: LlmJob<T>) =>
    costOf({ input: estimateTokens(job.request.system) + estimateTokens(job.request.user), output: job.expectedOutput }, client.config);

  const worker = async () => {
    for (;;) {
      if (summary.stopped || opts.signal?.aborted) {
        if (opts.signal?.aborted) summary.stopped = "aborted";
        return;
      }
      const job = queue.shift();
      if (!job) return;
      if (opts.maxCostUsd !== undefined && client.config.priceIn + client.config.priceOut > 0
        && summary.costUsd + estimate(job) > opts.maxCostUsd) {
        summary.stopped = "cost";
        return;
      }
      opts.onStart?.(job);
      try {
        const res = await client.complete(job.request, opts.signal);
        summary.usage.input += res.usage.input;
        summary.usage.output += res.usage.output;
        summary.costUsd = costOf(summary.usage, client.config);
        const parsed = job.parse(res.json);
        summary.done++;
        opts.onResult?.(job, parsed, res.usage);
      } catch (err) {
        const e = err instanceof LlmError ? err : new LlmError("invalid", err instanceof Error ? err.message : String(err));
        if (e.kind === "aborted") {
          summary.stopped = "aborted";
          return;
        }
        summary.failed++;
        summary.errors.push({ label: job.label, message: e.message });
        opts.onError?.(job, e);
        // Falscher Schlüssel: alle weiteren Anfragen scheitern genauso
        if (e.kind === "auth" || e.kind === "config") summary.stopped = "auth";
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, worker));
  summary.skipped = queue.length;
  return summary;
}
