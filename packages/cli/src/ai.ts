/**
 * KI-Befehle der Kommandozeile: `ai` (Buch verfeinern) und `eval` (Qualität messen).
 * Der Schlüssel kommt aus der Umgebung und wird nur als Header an die Basis-URL gesendet.
 */
import { createInterface } from "node:readline/promises";
import {
  applyEdit, castMergeJob, compareSpeakers, configFromPreset, costOf, estimateJobs, hostOf, LlmClient, presetById,
  pronunciationJob, PRESETS, runJobs, speakerJobs, type Book, type ProviderConfig, type SpeakerAccuracy, type Transport,
} from "@sprechbuch/core";

export interface AiArgs {
  provider?: string;
  model?: string;
  "base-url"?: string;
  tasks?: string;
  chapters?: string;
  "max-cost"?: string;
  "price-in"?: string;
  "price-out"?: string;
  "merge-cast"?: boolean;
  yes?: boolean;
}

export const AI_HELP = `  ai <buch.hbook> [-o ziel.hbook]
                        Sprecherzuordnung, Figuren und Aussprache per KI verfeinern
      --provider <id>       ${PRESETS.map((p) => p.id).join(", ")} (Standard: anthropic)
      --model <id>          Modell (Standard der Vorlage, bei Anthropic claude-opus-5)
      --base-url <url>      abweichender Endpunkt
      --tasks <liste>       speakers, cast, pronunciation (Standard: speakers,pronunciation)
      --chapters <liste>    nur diese Kapitel, z. B. 2-5 oder 1,3
      --max-cost <usd>      Kostenobergrenze (Standard: 5)
      --price-in/--price-out <usd>  Preise je 1 Mio. Token, falls die Vorlage keine kennt
      --merge-cast          sichere Figuren-Zusammenführungen (≥ 85 %) direkt anwenden
      --yes                 ohne Rückfrage starten
      Schlüssel aus ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY bzw. SPRECHBUCH_API_KEY
  eval <geprüft.hbook> [--provider … wie bei ai]
                        Zuordnung nur mit Regeln (und mit KI, falls --provider) gegen die eigenen
                        Entscheidungen im Buch messen; braucht die eingebettete Quelldatei`;

const ENV_KEYS: Record<string, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", openrouter: "OPENROUTER_API_KEY" };

function keyFor(config: ProviderConfig): string | null {
  if (!config.needsKey) return null;
  const name = ENV_KEYS[config.preset];
  const key = (name ? process.env[name] : undefined) ?? process.env.SPRECHBUCH_API_KEY;
  if (!key) throw new Error(`Kein Schlüssel: ${name ?? "SPRECHBUCH_API_KEY"} setzen.`);
  return key;
}

/** Transport für Node: fetch, Schlüssel als Header */
export function nodeTransport(key: string | null): Transport {
  return async (req, signal) => {
    const headers: Record<string, string> = { ...req.headers };
    if (key && req.auth === "x-api-key") headers["x-api-key"] = key;
    if (key && req.auth === "bearer") headers.authorization = `Bearer ${key}`;
    const res = await fetch(req.url, { method: req.method, headers, ...(req.body ? { body: req.body } : {}), ...(signal ? { signal } : {}) });
    const retry = Number(res.headers.get("retry-after"));
    return { status: res.status, body: await res.text(), ...(Number.isFinite(retry) && retry > 0 ? { retryAfter: retry } : {}) };
  };
}

export function configFromArgs(args: AiArgs): ProviderConfig {
  const preset = presetById(args.provider ?? "anthropic");
  if (!preset) throw new Error(`Unbekannter Anbieter: ${args.provider}`);
  const config = configFromPreset(preset, args.model ?? preset.defaultModel);
  if (args["base-url"]) config.baseUrl = args["base-url"];
  if (args["price-in"]) config.priceIn = Number(args["price-in"]);
  if (args["price-out"]) config.priceOut = Number(args["price-out"]);
  return config;
}

/** "2-5,7" (1-basiert) → Kapitelindizes */
export function parseChapters(list: string | undefined, count: number): number[] | undefined {
  if (!list) return undefined;
  const out = new Set<number>();
  for (const part of list.split(",").map((p) => p.trim()).filter(Boolean)) {
    const [a, b] = part.split("-").map((n) => Number(n));
    const from = a ?? NaN;
    const to = b ?? from;
    if (!Number.isInteger(from) || !Number.isInteger(to)) throw new Error(`Ungültige Kapitelangabe: ${part}`);
    for (let i = Math.max(1, from); i <= Math.min(count, to); i++) out.add(i - 1);
  }
  return [...out].sort((x, y) => x - y);
}

const usd = (n: number) => `${n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
const fmt = (n: number) => n.toLocaleString("de-DE");

async function confirm(question: string, yes: boolean | undefined): Promise<boolean> {
  if (yes) return true;
  if (!process.stdin.isTTY) throw new Error("Zum Starten ohne Rückfrage --yes angeben.");
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return /^(j|ja|y|yes)$/i.test((await rl.question(`${question} [j/N] `)).trim());
  } finally {
    rl.close();
  }
}

/** Verfeinert das Buch und liefert es zurück; `null`, wenn nicht gestartet */
export async function runAi(book: Book, args: AiArgs, log = (s: string) => process.stderr.write(`${s}\n`)): Promise<Book | null> {
  const config = configFromArgs(args);
  const client = new LlmClient(config, nodeTransport(keyFor(config)));
  const tasks = new Set((args.tasks ?? "speakers,pronunciation").split(",").map((t) => t.trim()));
  const chapters = parseChapters(args.chapters, book.chapters.length);
  const maxCost = args["max-cost"] ? Number(args["max-cost"]) : 5;

  const sJobs = tasks.has("speakers") ? speakerJobs(book, chapters ? { chapters } : {}) : [];
  const cJob = tasks.has("cast") ? castMergeJob(book) : null;
  const pJob = tasks.has("pronunciation") ? pronunciationJob(book) : null;
  const all = [...sJobs, ...(cJob ? [cJob] : []), ...(pJob ? [pJob] : [])];
  if (!all.length) {
    log("Nichts zu tun – keine unsicheren Zuordnungen bzw. offenen Aussprachen.");
    return book;
  }
  const est = estimateJobs(all, config);
  log(`${config.label} · ${config.model} · Text geht an ${hostOf(config.baseUrl)}${config.local ? " (lokal)" : ""}`);
  log(`${fmt(est.requests)} Anfragen · ca. ${fmt(est.input)} Eingabe- und ${fmt(est.output)} Ausgabetoken${config.priceIn + config.priceOut ? ` · ca. ${usd(est.costUsd)} (Obergrenze ${usd(maxCost)})` : ""}`);
  if (!(await confirm("Starten?", args.yes))) return null;

  let current = book;
  let changed = 0;
  const summary = await runJobs<unknown>(client, all as never, {
    maxCostUsd: maxCost,
    onResult(job, result) {
      if (job.key.startsWith("speakers:")) {
        const r = result as { items: import("@sprechbuch/core").SpeakerSuggestion[] };
        const res = applyEdit(current, { type: "applySpeakerSuggestions", model: config.model, items: r.items });
        current = res.book;
        changed += r.items.length;
        log(`  ✓ ${job.label}: ${r.items.length} Einschätzungen`);
      } else if (job.key === "pronunciation") {
        const items = result as import("@sprechbuch/core").PronunciationSuggestion[];
        current = applyEdit(current, { type: "applyPronunciationSuggestions", model: config.model, items }).book;
        log(`  ✓ Aussprache: ${items.length} Vorschläge`);
      } else if (job.key === "cast") {
        const merges = result as import("@sprechbuch/core").MergeSuggestion[];
        const name = (id: string) => current.cast.find((c) => c.id === id)?.name ?? id;
        log(`  ✓ Figuren: ${merges.length} Vorschläge`);
        for (const m of merges) {
          const apply = args["merge-cast"] && m.confidence >= 0.85 && current.cast.some((c) => c.id === m.from) && current.cast.some((c) => c.id === m.into);
          log(`    ${apply ? "→ zusammengeführt" : "  Vorschlag"}: ${name(m.from)} = ${name(m.into)} (${Math.round(m.confidence * 100)} %) ${m.reason}`);
          if (apply) current = applyEdit(current, { type: "mergeCast", from: m.from, into: m.into }).book;
        }
      }
    },
    onError: (job, err) => log(`  ✗ ${job.label}: ${err.message}`),
  });
  log(`Fertig: ${summary.done} erledigt, ${summary.failed} fehlgeschlagen${summary.skipped ? `, ${summary.skipped} nicht gestartet (${summary.stopped === "cost" ? "Kostengrenze" : summary.stopped === "auth" ? "Schlüssel" : "Abbruch"})` : ""} · ${fmt(summary.usage.input)} + ${fmt(summary.usage.output)} Token${config.priceIn + config.priceOut ? ` · ${usd(costOf(summary.usage, config))}` : ""}`);
  if (changed) log(`${fmt(changed)} Redeteile eingeschätzt.`);
  if (!summary.done && summary.failed) throw new Error(summary.errors[0]?.message ?? "Keine Anfrage war erfolgreich.");
  return current;
}

export function accuracyTable(rows: [string, SpeakerAccuracy][]): string {
  const ref = rows[0]?.[1];
  const head = `Referenz: ${fmt(ref?.reference ?? 0)} geprüfte Redeteile, davon ${fmt(ref?.found ?? 0)} wiedergefunden\n\n`;
  const cols = ["richtig", "falsch", "ohne Figur", "zur Prüfung", "still falsch"];
  const pct = (n: number, of: number) => `${fmt(n)} (${of ? ((100 * n) / of).toFixed(1) : "0.0"} %)`;
  const lines = [`${"".padEnd(16)}${cols.map((c) => c.padStart(18)).join("")}`];
  for (const [label, r] of rows) {
    lines.push(`${label.padEnd(16)}${[r.correct, r.wrong, r.unattributed, r.queued, r.silentWrong].map((n) => pct(n, r.found).padStart(18)).join("")}`);
  }
  return head + lines.join("\n") + "\n\n„still falsch“: falsch zugeordnet und nicht zur Prüfung vorgesehen – das zählt.";
}

export { compareSpeakers };
