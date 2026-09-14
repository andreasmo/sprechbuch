/**
 * Ein Aufruf an ein Sprachmodell: Anfrage bauen, über einen Transport schicken, Antwort als JSON
 * zurückgeben. Wiederholungen bei Überlastung, Herunterstufen bei Servern ohne JSON-Schema.
 *
 * Der Transport ist austauschbar: Desktop → Rust (hängt den Schlüssel aus dem OS-Tresor an und
 * umgeht CORS), Web → fetch, CLI → fetch mit Schlüssel aus der Umgebung, Tests → Attrappe.
 */
import { authStyle, normalizeBaseUrl, type AuthStyle, type ProviderConfig, type StructuredMode } from "./providers.js";

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

export interface CompletionResult {
  json: unknown;
  usage: Usage;
}

export const costOf = (usage: Usage, config: Pick<ProviderConfig, "priceIn" | "priceOut">) =>
  (usage.input * config.priceIn + usage.output * config.priceOut) / 1_000_000;

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

const MAX_ATTEMPTS = 4;

export class LlmClient {
  readonly config: ProviderConfig;
  readonly #transport: Transport;
  /** Bei OpenAI-kompatiblen Servern ggf. heruntergestuft */
  #structured: StructuredMode;

  constructor(config: ProviderConfig, transport: Transport) {
    this.config = { ...config, baseUrl: normalizeBaseUrl(config.baseUrl) };
    this.#transport = transport;
    this.#structured = config.structured;
    if (!this.config.baseUrl) throw new LlmError("config", "Keine Basis-URL eingetragen.");
    if (!this.config.model) throw new LlmError("config", "Kein Modell gewählt.");
  }

  get structured(): StructuredMode {
    return this.#structured;
  }

  async complete(req: CompletionRequest, signal?: AbortSignal): Promise<CompletionResult> {
    for (let attempt = 1; ; attempt++) {
      if (signal?.aborted) throw new LlmError("aborted", "Abgebrochen");
      const http = this.config.kind === "anthropic" ? this.#anthropic(req) : this.#openai(req);
      let res: HttpResponse;
      try {
        res = await this.#transport(http, signal);
      } catch (err) {
        if (signal?.aborted) throw new LlmError("aborted", "Abgebrochen");
        if (attempt >= MAX_ATTEMPTS) throw new LlmError("network", `Keine Verbindung zu ${this.config.baseUrl}: ${err instanceof Error ? err.message : String(err)}`);
        await sleep(1000 * 2 ** (attempt - 1), signal);
        continue;
      }

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
      if (res.status === 400 && this.config.kind === "openai" && this.#structured !== "prompt" && /response_format|json_schema|json_object|schema/i.test(res.body)) {
        // Server kann kein JSON-Schema bzw. keinen JSON-Modus – eine Stufe einfacher versuchen
        this.#structured = this.#structured === "schema" ? "json" : "prompt";
        continue;
      }
      if (res.status >= 400) {
        throw new LlmError("invalid", `Anfrage abgelehnt (${res.status}): ${errorMessage(res.body)}`, res.status);
      }

      try {
        return this.config.kind === "anthropic" ? this.#parseAnthropic(res.body) : this.#parseOpenai(res.body);
      } catch (err) {
        // Ungültiges JSON bei Servern ohne Schema: einmal neu versuchen
        if (err instanceof LlmError && err.kind === "invalid" && attempt < 2) continue;
        throw err;
      }
    }
  }

  /** Verfügbare Modelle (sofern der Anbieter eine Liste liefert) */
  async listModels(signal?: AbortSignal): Promise<string[]> {
    const res = await this.#transport({
      provider: this.config.preset, url: `${this.config.baseUrl}/models`, method: "GET", auth: authStyle(this.config),
      headers: this.config.kind === "anthropic" ? { "anthropic-version": "2023-06-01" } : {},
    }, signal);
    if (res.status === 401 || res.status === 403) throw new LlmError("auth", `Zugriff verweigert (${res.status}): ${errorMessage(res.body)}`, res.status);
    if (res.status >= 400) throw new LlmError("invalid", `Modellliste nicht verfügbar (${res.status}): ${errorMessage(res.body)}`, res.status);
    const j = JSON.parse(res.body) as { data?: { id: string }[]; models?: { name?: string; model?: string }[] };
    const ids = j.data?.map((m) => m.id) ?? j.models?.map((m) => m.model ?? m.name ?? "") ?? [];
    return [...new Set(ids.filter(Boolean))].sort();
  }

  /** Kleine Probeanfrage: Stimmen Schlüssel, Modell und strukturierte Antworten? */
  async test(signal?: AbortSignal): Promise<CompletionResult> {
    const res = await this.complete({
      system: "Antworte ausschließlich mit JSON.",
      user: "Bestätige die Verbindung mit {\"ok\": true}.",
      schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
      schemaName: "verbindung",
      maxTokens: 50,
    }, signal);
    if ((res.json as { ok?: unknown })?.ok !== true) throw new LlmError("invalid", "Das Modell hat die Probeanfrage nicht wie erwartet beantwortet.");
    return res;
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
