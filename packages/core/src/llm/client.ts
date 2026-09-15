/**
 * Ein Aufruf an ein Sprachmodell: Anfrage bauen, über einen Transport schicken, Antwort als JSON
 * zurückgeben. Wiederholungen bei Überlastung, Herunterstufen bei Servern ohne JSON-Schema.
 *
 * Der Transport ist austauschbar: Desktop → Rust (hängt den Schlüssel aus dem OS-Tresor an und
 * umgeht CORS), Web → fetch, CLI → fetch mit Schlüssel aus der Umgebung, Tests → Attrappe.
 */
import { authStyle, LOCAL_CONTEXT_TOKENS, normalizeBaseUrl, type AuthStyle, type ProviderConfig, type StructuredMode } from "./providers.js";

export interface HttpRequest {
  /** Vorlage/Schlüsselname, damit der Transport den richtigen Schlüssel findet */
  provider: string;
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  auth: AuthStyle;
}

export interface HttpResponse {
  status: number;
  body: string;
  /** Sekunden aus `retry-after`, falls gesendet */
  retryAfter?: number;
}

export type Transport = (req: HttpRequest, signal?: AbortSignal) => Promise<HttpResponse>;

export type LlmErrorKind = "auth" | "rate" | "server" | "invalid" | "network" | "config" | "aborted" | "refused" | "truncated";

export class LlmError extends Error {
  constructor(readonly kind: LlmErrorKind, message: string, readonly status?: number) {
    super(message);
    this.name = "LlmError";
  }
}

/** JSON-Schema-Teilmenge, die alle Anbieter verstehen (keine min/max, additionalProperties: false) */
export type JsonSchema = Record<string, unknown>;

export interface CompletionRequest {
  system: string;
  user: string;
  schema: JsonSchema;
  /** Name des Schemas (OpenAI verlangt ihn) */
  schemaName: string;
  maxTokens: number;
}

export interface Usage {
  input: number;
  output: number;
}

/** Wie lange eine Anfrage gedauert hat – Grundlage der Zeitschätzung bei lokalen Modellen */
export interface Timing {
  totalMs: number;
  /** nur Ollama: Einlesen und Schreiben getrennt gemessen (ohne Ladezeit des Modells) */
  promptMs?: number;
  outputMs?: number;
  promptTokens?: number;
  outputTokens?: number;
}

export interface CompletionResult {
  json: unknown;
  usage: Usage;
  timing?: Timing;
}

/** Was Ollama über ein Modell weiß */
export interface ModelInfo {
  /** größtes Kontextfenster des Modells */
  contextLength?: number;
  /** kann „nachdenken“ – wird für die Zuordnung abgeschaltet */
  thinking: boolean;
}

export const costOf = (usage: Usage, config: Pick<ProviderConfig, "priceIn" | "priceOut">) =>
  (usage.input * config.priceIn + usage.output * config.priceOut) / 1_000_000;

/**
 * Vorsichtige Tokenschätzung für die Frage „passt das ins Kontextfenster?“ – lieber zu viel als
 * zu wenig (deutscher Text: gemessen ~3,1 Zeichen je Token).
 */
export const contextTokensOf = (text: string) => Math.ceil(text.length / 2.6);

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new LlmError("aborted", "Abgebrochen"));
    }, { once: true });
  });

/** JSON aus einer Modellantwort holen – auch aus ```json-Blöcken oder mit Vor- und Nachtext. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
    const candidate = fence?.[1] ?? trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      throw new LlmError("invalid", "Die Antwort des Modells war kein gültiges JSON.");
    }
  }
}

function errorMessage(body: string): string {
  try {
    const j = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    if (typeof j.error === "string") return j.error;
    return j.error?.message ?? j.message ?? body.slice(0, 300);
  } catch {
    return body.slice(0, 300);
  }
}

/** Neutraler Probetext (~500 Token) für die Geschwindigkeitsmessung lokaler Modelle */
const PROBE_TEXT = [
  "Am Morgen lag dichter Nebel über dem Fluss, und die Fähre wartete am Steg, bis der Fährmann die Laterne gelöscht hatte.",
  "Auf der anderen Seite standen schon die ersten Marktleute mit ihren Körben voller Äpfel, Zwiebeln und frischem Brot.",
  "Ein Junge trieb drei Ziegen den Uferweg entlang und rief jedem, der ihm begegnete, einen fröhlichen Gruß zu.",
  "Die Glocke der kleinen Kirche schlug sieben Mal, als die Fähre ablegte und langsam in den grauen Dunst hineinglitt.",
  "Niemand sprach während der Überfahrt; man hörte nur das Knarren der Taue und das leise Plätschern am Rumpf.",
  "Erst als die Sonne den Nebel zerriss, kamen die Häuser des Dorfes zum Vorschein, mit ihren roten Dächern und weißen Mauern.",
  "Die Marktfrau mit dem blauen Kopftuch zählte ihre Münzen und nickte zufrieden, denn der Weg hatte sich gelohnt.",
  "Am Ufer wartete bereits der Bürgermeister, der die Ankunft der Händler jedes Jahr mit einer kurzen Rede begrüßte.",
  "Er sprach vom guten Wetter, von der reichen Ernte und davon, dass der alte Steg im Herbst endlich erneuert werden sollte.",
  "Die Leute klatschten höflich, luden ihre Waren ab und verteilten sich zwischen den Ständen auf dem kleinen Platz.",
  "Gegen Mittag roch es nach gebratenen Würsten und heißem Kaffee, und die Kinder liefen mit klebrigen Fingern umher.",
  "Als am Abend die letzten Stände abgebaut waren, legte die Fähre ein letztes Mal ab und brachte alle wieder zurück.",
].join(" ");

const MAX_ATTEMPTS = 4;
/** Platz, der im Kontextfenster mindestens für die Antwort bleiben muss */
const MIN_OUTPUT = 512;

export class LlmClient {
  readonly config: ProviderConfig;
  readonly #transport: Transport;
  /** Bei OpenAI-kompatiblen Servern ggf. heruntergestuft */
  #structured: StructuredMode;
  #modelInfo: ModelInfo | null = null;
  /** Ollama lehnt `think` bei manchen Modellen ab – dann ohne */
  #sendThink = true;

  constructor(config: ProviderConfig, transport: Transport) {
    this.config = { ...config, baseUrl: normalizeBaseUrl(config.baseUrl, config.kind) };
    this.#transport = transport;
    this.#structured = config.structured;
    if (!this.config.baseUrl) throw new LlmError("config", "Keine Basis-URL eingetragen.");
    if (!this.config.model) throw new LlmError("config", "Kein Modell gewählt.");
  }

  get structured(): StructuredMode {
    return this.#structured;
  }

  /** Nach der ersten Ollama-Anfrage bekannt */
  get modelInfo(): ModelInfo | null {
    return this.#modelInfo;
  }

  /** Kontextfenster, mit dem tatsächlich gerechnet wird (Einstellung, begrenzt durch das Modell) */
  get contextTokens(): number | undefined {
    const wanted = this.config.contextTokens ?? (this.config.kind === "ollama" ? LOCAL_CONTEXT_TOKENS : undefined);
    const max = this.#modelInfo?.contextLength;
    return wanted && max ? Math.min(wanted, max) : wanted;
  }

  async complete(req: CompletionRequest, signal?: AbortSignal): Promise<CompletionResult> {
    if (this.config.kind === "ollama" && !this.#modelInfo) this.#modelInfo = await this.#ollamaShow(signal);
    for (let attempt = 1; ; attempt++) {
      if (signal?.aborted) throw new LlmError("aborted", "Abgebrochen");
      const http = this.config.kind === "anthropic" ? this.#anthropic(req) : this.config.kind === "ollama" ? this.#ollama(req) : this.#openai(req);
      let res: HttpResponse;
      const started = now();
      try {
        res = await this.#transport(http, signal);
      } catch (err) {
        if (signal?.aborted) throw new LlmError("aborted", "Abgebrochen");
        if (attempt >= MAX_ATTEMPTS) throw this.#networkError(err);
        await sleep(1000 * 2 ** (attempt - 1), signal);
        continue;
      }
      const totalMs = now() - started;

      if (res.status === 401 || res.status === 403) {
        throw new LlmError("auth", `Zugriff verweigert (${res.status}): ${errorMessage(res.body)}`, res.status);
      }
      if (res.status === 429 || res.status === 529 || res.status >= 500) {
        if (attempt >= MAX_ATTEMPTS) {
          throw new LlmError(res.status === 429 ? "rate" : "server", `Anbieter überlastet (${res.status}): ${errorMessage(res.body)}`, res.status);
        }
        await sleep(res.retryAfter !== undefined ? res.retryAfter * 1000 : 1500 * 2 ** (attempt - 1), signal);
        continue;
      }
      const formatRejected = (this.config.kind === "ollama" ? /format|schema/i : /response_format|json_schema|json_object|schema/i).test(res.body);
      if (res.status === 400 && this.config.kind !== "anthropic" && this.#structured !== "prompt" && formatRejected) {
        // Server kann kein JSON-Schema bzw. keinen JSON-Modus – eine Stufe einfacher versuchen
        this.#structured = this.#structured === "schema" ? "json" : "prompt";
        continue;
      }
      if (res.status === 400 && this.config.kind === "ollama" && this.#sendThink && /think/i.test(res.body)) {
        this.#sendThink = false;
        continue;
      }
      if (res.status === 404 && this.config.kind === "ollama") {
        throw new LlmError("config", `Ollama kennt das Modell „${this.config.model}“ nicht – im Terminal „ollama pull ${this.config.model}“ ausführen.`, 404);
      }
      if (res.status >= 400) {
        throw new LlmError("invalid", `Anfrage abgelehnt (${res.status}): ${errorMessage(res.body)}`, res.status);
      }

      try {
        const result = this.config.kind === "anthropic" ? this.#parseAnthropic(res.body)
          : this.config.kind === "ollama" ? this.#parseOllama(res.body) : this.#parseOpenai(res.body);
        result.timing = { ...result.timing, totalMs };
        if (this.config.kind === "openai" && this.config.local) this.#checkTruncatedPrompt(req, result.usage);
        return result;
      } catch (err) {
        // Ungültiges JSON bei Servern ohne Schema: einmal neu versuchen
        if (err instanceof LlmError && err.kind === "invalid" && attempt < 2) continue;
        throw err;
      }
    }
  }

  /** Verfügbare Modelle (sofern der Anbieter eine Liste liefert) */
  async listModels(signal?: AbortSignal): Promise<string[]> {
    const path = this.config.kind === "ollama" ? "/api/tags" : "/models";
    let res: HttpResponse;
    try {
      res = await this.#transport({
        provider: this.config.preset, url: `${this.config.baseUrl}${path}`, method: "GET", auth: authStyle(this.config),
        headers: this.config.kind === "anthropic" ? { "anthropic-version": "2023-06-01" } : {},
      }, signal);
    } catch (err) {
      throw this.#networkError(err);
    }
    if (res.status === 401 || res.status === 403) throw new LlmError("auth", `Zugriff verweigert (${res.status}): ${errorMessage(res.body)}`, res.status);
    if (res.status >= 400) throw new LlmError("invalid", `Modellliste nicht verfügbar (${res.status}): ${errorMessage(res.body)}`, res.status);
    const j = JSON.parse(res.body) as { data?: { id: string }[]; models?: { name?: string; model?: string }[] };
    const ids = j.data?.map((m) => m.id) ?? j.models?.map((m) => m.model ?? m.name ?? "") ?? [];
    return [...new Set(ids.filter(Boolean))].sort();
  }

  /**
   * Probeanfrage: Stimmen Schlüssel, Modell und strukturierte Antworten? Bei lokalen Modellen mit
   * etwas Text, damit die Geschwindigkeit fürs Einlesen und Schreiben messbar ist.
   */
  async test(signal?: AbortSignal): Promise<CompletionResult> {
    const local = this.config.local || this.config.kind === "ollama";
    const res = await this.complete({
      system: "Antworte ausschließlich mit JSON.",
      user: local
        ? `Bestätige die Verbindung mit ok = true und gib die ersten zwanzig Wörter dieses Textes als Liste woerter zurück.\n\n${PROBE_TEXT}`
        : "Bestätige die Verbindung mit {\"ok\": true}.",
      schema: local
        ? { type: "object", properties: { ok: { type: "boolean" }, woerter: { type: "array", items: { type: "string" } } }, required: ["ok", "woerter"], additionalProperties: false }
        : { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
      schemaName: "verbindung",
      maxTokens: local ? 300 : 50,
    }, signal);
    if ((res.json as { ok?: unknown })?.ok !== true) throw new LlmError("invalid", "Das Modell hat die Probeanfrage nicht wie erwartet beantwortet.");
    return res;
  }

  #networkError(err: unknown): LlmError {
    const detail = err instanceof Error ? err.message : String(err);
    const hint = this.config.kind === "ollama" ? " – läuft Ollama?" : this.config.local ? " – läuft der lokale Server?" : "";
    return new LlmError("network", `Keine Verbindung zu ${this.config.baseUrl}${hint} (${detail})`);
  }

  /** Lokale OpenAI-kompatible Server (LM Studio, vLLM …) schneiden zu lange Eingaben oft still ab */
  #checkTruncatedPrompt(req: CompletionRequest, usage: Usage): void {
    const expected = Math.ceil((req.system.length + req.user.length) / 3);
    if (usage.input > 0 && expected > 1500 && usage.input < expected * 0.6) {
      throw new LlmError("truncated",
        `Der Server hat den Text abgeschnitten: verarbeitet wurden ${usage.input} von etwa ${expected} Token. `
        + "Die Kontextlänge im Server erhöhen (LM Studio: beim Laden des Modells) oder das Kontextfenster in den KI-Einstellungen passend verkleinern.");
    }
  }

  async #ollamaShow(signal?: AbortSignal): Promise<ModelInfo> {
    let res: HttpResponse;
    try {
      res = await this.#transport({
        provider: this.config.preset, url: `${this.config.baseUrl}/api/show`, method: "POST", auth: authStyle(this.config),
        headers: { "content-type": "application/json" }, body: JSON.stringify({ model: this.config.model }),
      }, signal);
    } catch (err) {
      if (signal?.aborted) throw new LlmError("aborted", "Abgebrochen");
      throw this.#networkError(err);
    }
    if (res.status === 404) {
      throw new LlmError("config", `Ollama kennt das Modell „${this.config.model}“ nicht – im Terminal „ollama pull ${this.config.model}“ ausführen.`, 404);
    }
    if (res.status === 401 || res.status === 403) throw new LlmError("auth", `Zugriff verweigert (${res.status}): ${errorMessage(res.body)}`, res.status);
    // Ältere Ollama-Versionen: ohne Angaben weiter, das Kontextfenster aus der Einstellung gilt
    if (res.status >= 400) return { thinking: false };
    try {
      const j = JSON.parse(res.body) as { model_info?: Record<string, unknown>; capabilities?: string[] };
      const key = Object.keys(j.model_info ?? {}).find((k) => k.endsWith(".context_length"));
      const ctx = key ? Number(j.model_info![key]) : NaN;
      return { ...(ctx > 0 ? { contextLength: ctx } : {}), thinking: j.capabilities?.includes("thinking") ?? false };
    } catch {
      return { thinking: false };
    }
  }

  #ollama(req: CompletionRequest): HttpRequest {
    const numCtx = this.contextTokens ?? LOCAL_CONTEXT_TOKENS;
    const mode = this.#structured;
    const system = mode === "schema" ? req.system
      : `${req.system}\n\nAntworte ausschließlich mit einem JSON-Objekt nach diesem JSON-Schema, ohne weiteren Text:\n${JSON.stringify(req.schema)}`;
    const input = contextTokensOf(system) + contextTokensOf(req.user) + 50;
    if (input + MIN_OUTPUT > numCtx) {
      throw new LlmError("config",
        `Der Abschnitt ist zu lang für das Kontextfenster (etwa ${input} Token Eingabe, Fenster ${numCtx} Token). `
        + "In den KI-Einstellungen das Kontextfenster vergrößern.");
    }
    return {
      provider: this.config.preset,
      url: `${this.config.baseUrl}/api/chat`,
      method: "POST",
      auth: authStyle(this.config),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.config.model,
        messages: [{ role: "system", content: system }, { role: "user", content: req.user }],
        stream: false,
        ...(mode === "schema" ? { format: req.schema } : mode === "json" ? { format: "json" } : {}),
        // Nachdenken kostet auf dem eigenen Rechner Minuten und hilft bei der Zuordnung kaum
        ...(this.#sendThink && this.#modelInfo?.thinking ? { think: false } : {}),
        options: { num_ctx: numCtx, num_predict: Math.min(req.maxTokens, numCtx - input), temperature: 0.2 },
      }),
    };
  }

  #parseOllama(body: string): CompletionResult {
    const j = JSON.parse(body) as {
      message?: { content?: string };
      done_reason?: string;
      error?: string;
      prompt_eval_count?: number;
      prompt_eval_duration?: number;
      eval_count?: number;
      eval_duration?: number;
    };
    if (j.error) throw new LlmError("invalid", `Ollama: ${j.error}`);
    if (j.done_reason === "length") {
      throw new LlmError("truncated", "Die Antwort wurde abgeschnitten – das Kontextfenster ist zu klein. In den KI-Einstellungen vergrößern.");
    }
    const ms = (ns?: number) => (ns ? ns / 1e6 : undefined);
    return {
      json: extractJson(j.message?.content ?? ""),
      usage: { input: j.prompt_eval_count ?? 0, output: j.eval_count ?? 0 },
      timing: {
        totalMs: 0,
        ...(j.prompt_eval_duration ? { promptMs: ms(j.prompt_eval_duration), promptTokens: j.prompt_eval_count ?? 0 } : {}),
        ...(j.eval_duration ? { outputMs: ms(j.eval_duration), outputTokens: j.eval_count ?? 0 } : {}),
      },
    };
  }

  #anthropic(req: CompletionRequest): HttpRequest {
    return {
      provider: this.config.preset,
      url: `${this.config.baseUrl}/messages`,
      method: "POST",
      auth: authStyle(this.config),
      headers: { "content-type": "application/json", "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: "user", content: req.user }],
        output_config: { format: { type: "json_schema", schema: req.schema } },
      }),
    };
  }

  #parseAnthropic(body: string): CompletionResult {
    const j = JSON.parse(body) as {
      content?: { type: string; text?: string }[];
      stop_reason?: string;
      usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
    };
    if (j.stop_reason === "refusal") throw new LlmError("refused", "Das Modell hat die Anfrage abgelehnt.");
    if (j.stop_reason === "max_tokens") throw new LlmError("truncated", "Die Antwort wurde abgeschnitten (Längengrenze).");
    const text = (j.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
    const u = j.usage ?? {};
    return {
      json: extractJson(text),
      usage: { input: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), output: u.output_tokens ?? 0 },
    };
  }

  #openai(req: CompletionRequest): HttpRequest {
    const mode = this.#structured;
    const format = mode === "schema"
      ? { response_format: { type: "json_schema", json_schema: { name: req.schemaName, schema: req.schema, strict: true } } }
      : mode === "json" ? { response_format: { type: "json_object" } } : {};
    // Ohne Schema beschreibt der Prompt die Form
    const system = mode === "schema" ? req.system
      : `${req.system}\n\nAntworte ausschließlich mit einem JSON-Objekt nach diesem JSON-Schema, ohne weiteren Text:\n${JSON.stringify(req.schema)}`;
    return {
      provider: this.config.preset,
      url: `${this.config.baseUrl}/chat/completions`,
      method: "POST",
      auth: authStyle(this.config),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: req.maxTokens,
        messages: [{ role: "system", content: system }, { role: "user", content: req.user }],
        ...format,
      }),
    };
  }

  #parseOpenai(body: string): CompletionResult {
    const j = JSON.parse(body) as {
      choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const choice = j.choices?.[0];
    if (!choice) throw new LlmError("invalid", "Leere Antwort vom Modell.");
    if (choice.message?.refusal) throw new LlmError("refused", `Das Modell hat abgelehnt: ${choice.message.refusal}`);
    if (choice.finish_reason === "length") throw new LlmError("truncated", "Die Antwort wurde abgeschnitten (Längengrenze).");
    return {
      json: extractJson(choice.message?.content ?? ""),
      usage: { input: j.usage?.prompt_tokens ?? 0, output: j.usage?.completion_tokens ?? 0 },
    };
  }
}
