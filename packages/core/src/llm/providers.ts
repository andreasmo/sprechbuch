/**
 * KI-Anbieter: drei Protokolle decken praktisch alles ab.
 *
 * - `anthropic`: Anthropic Messages API mit strukturierten Antworten (`output_config.format`).
 * - `openai`: OpenAI-kompatibles `/chat/completions` – OpenAI, OpenRouter, Mistral, Groq,
 *   Azure OpenAI, aber auch lokale Server wie LM Studio oder vLLM.
 * - `ollama`: Ollamas eigene Schnittstelle `/api/chat`. Nur dort lässt sich das Kontextfenster
 *   pro Anfrage setzen – über den OpenAI-kompatiblen Weg schneidet Ollama lange Kapitel
 *   stillschweigend auf wenige tausend Token ab.
 *
 * Schlüssel stehen nie in dieser Konfiguration. Sie liegen im Tresor des Betriebssystems und
 * werden erst im Transport (Desktop: Rust) an die Anfrage gehängt.
 */

export type ProviderKind = "anthropic" | "openai" | "ollama";
/** Wie der Schlüssel übergeben wird */
export type AuthStyle = "x-api-key" | "bearer" | "none";
/**
 * Strukturierte Antworten bei OpenAI-kompatiblen Servern: JSON-Schema, wo möglich; sonst JSON-Modus;
 * sonst nur Anweisung im Prompt. Die App stuft bei Ablehnung selbst herunter.
 */
export type StructuredMode = "schema" | "json" | "prompt";

export interface ModelPreset {
  id: string;
  label: string;
  /** US-Dollar je 1 Mio. Token */
  priceIn: number;
  priceOut: number;
}

export interface ProviderPreset {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  needsKey: boolean;
  /** Läuft auf dem eigenen Rechner – kein Text verlässt das Gerät */
  local: boolean;
  models: ModelPreset[];
  defaultModel: string;
  /** Wo man einen Schlüssel bekommt bzw. was zu tun ist */
  hint: string;
}

export interface ProviderConfig {
  /** ID der Vorlage – zugleich Name des Schlüssels im Tresor */
  preset: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  needsKey: boolean;
  local: boolean;
  priceIn: number;
  priceOut: number;
  /** gleichzeitige Anfragen */
  concurrency: number;
  structured: StructuredMode;
  /**
   * Kontextfenster in Token (lokale Modelle). Bestimmt, wie lang ein Abschnitt pro Anfrage sein
   * darf; bei Ollama wird es mit jeder Anfrage gesetzt (`num_ctx`).
   */
  contextTokens?: number;
}

/** Standard-Kontextfenster lokaler Modelle: reicht für ~50 000 Zeichen je Abschnitt plus Antwort */
export const LOCAL_CONTEXT_TOKENS = 32_768;

export const PRESETS: ProviderPreset[] = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    needsKey: true,
    local: false,
    models: [
      { id: "claude-opus-5", label: "Claude Opus 5 – beste Qualität", priceIn: 5, priceOut: 25 },
      { id: "claude-sonnet-5", label: "Claude Sonnet 5 – günstiger", priceIn: 2, priceOut: 10 },
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 – am günstigsten", priceIn: 1, priceOut: 5 },
      { id: "claude-fable-5-1", label: "Claude Fable 5.1 – Spitzenmodell", priceIn: 10, priceOut: 50 },
    ],
    defaultModel: "claude-opus-5",
    hint: "Schlüssel unter platform.claude.com → API Keys anlegen.",
  },
  {
    id: "openai",
    label: "OpenAI",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    needsKey: true,
    local: false,
    models: [],
    defaultModel: "",
    hint: "Schlüssel unter platform.openai.com → API keys. Modell über „Modelle laden“ wählen, Preise eintragen.",
  },
  {
    id: "openrouter",
    label: "OpenRouter (viele Modelle)",
    kind: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    needsKey: true,
    local: false,
    models: [],
    defaultModel: "",
    hint: "Schlüssel unter openrouter.ai → Keys. Modell-IDs wie „anthropic/claude-opus-5“.",
  },
  {
    id: "ollama",
    label: "Ollama (lokal)",
    kind: "ollama",
    baseUrl: "http://localhost:11434",
    needsKey: false,
    local: true,
    models: [],
    defaultModel: "",
    hint: "Ollama installieren (ollama.com) und ein Modell laden, z. B. „ollama pull gemma4:26b“. Der Text bleibt auf diesem Rechner.",
  },
  {
    id: "lmstudio",
    label: "LM Studio (lokal)",
    kind: "openai",
    baseUrl: "http://localhost:1234/v1",
    needsKey: false,
    local: true,
    models: [],
    defaultModel: "",
    hint: "In LM Studio ein Modell laden – Kontextlänge beim Laden mindestens so groß wie unten eingestellt – und den lokalen Server starten. Der Text bleibt auf diesem Rechner.",
  },
  {
    id: "custom",
    label: "Eigener Endpunkt (OpenAI-kompatibel)",
    kind: "openai",
    baseUrl: "",
    needsKey: true,
    local: false,
    models: [],
    defaultModel: "",
    hint: "Basis-URL bis einschließlich /v1 angeben, z. B. https://mein-server/v1.",
  },
];

export const presetById = (id: string) => PRESETS.find((p) => p.id === id);

export function configFromPreset(preset: ProviderPreset, model = preset.defaultModel): ProviderConfig {
  const m = preset.models.find((x) => x.id === model);
  return {
    preset: preset.id,
    label: preset.label,
    kind: preset.kind,
    baseUrl: preset.baseUrl,
    model,
    needsKey: preset.needsKey,
    local: preset.local,
    priceIn: m?.priceIn ?? 0,
    priceOut: m?.priceOut ?? 0,
    concurrency: preset.local ? 1 : 4,
    structured: "schema",
    ...(preset.local ? { contextTokens: LOCAL_CONTEXT_TOKENS } : {}),
  };
}

/**
 * Gespeicherte Einstellungen älterer Versionen nachziehen: Ollama lief früher über den
 * OpenAI-kompatiblen Weg (`…/v1`), lokale Modelle hatten kein Kontextfenster.
 */
export function migrateConfig(config: ProviderConfig): ProviderConfig {
  const next = { ...config };
  if (next.preset === "ollama" && next.kind === "openai") {
    next.kind = "ollama";
    next.baseUrl = normalizeBaseUrl(next.baseUrl).replace(/\/v1$/, "");
  }
  if ((next.local || next.kind === "ollama") && !next.contextTokens) next.contextTokens = LOCAL_CONTEXT_TOKENS;
  return next;
}

export const authStyle = (config: Pick<ProviderConfig, "kind" | "needsKey">): AuthStyle =>
  !config.needsKey ? "none" : config.kind === "anthropic" ? "x-api-key" : "bearer";

/** Basis-URL ohne abschließenden Schrägstrich (bei Ollama auch ohne `/v1` bzw. `/api`) */
export const normalizeBaseUrl = (url: string, kind?: ProviderKind) => {
  const base = url.trim().replace(/\/+$/, "");
  return kind === "ollama" ? base.replace(/\/(v1|api)$/, "") : base;
};

/** Host für den Datenschutzhinweis („Text geht an api.anthropic.com“) */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Läuft der Endpunkt auf diesem Rechner oder im lokalen Netz? Gleiche Regeln wie `is_local_host`
 * in `apps/desktop/src-tauri/src/ai.rs` – dort wird „Nur lokale KI“ durchgesetzt.
 *
 * Lokal sind: localhost, Loopback, private und Link-Local-Adressen (IPv4 und IPv6), Rechnernamen
 * ohne Punkt („gpu-box“) sowie die Endungen .local, .lan, .home.arpa und .internal.
 */
export function isLocalUrl(url: string): boolean {
  let h: string;
  try {
    h = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return false;
  }
  if (!h) return false;
  if (h.includes(":")) return h === "::1" || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    return /^(127|10)\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h);
  }
  return h === "localhost" || !h.includes(".") || /\.(local|lan|home\.arpa|internal)$/.test(h) || h.endsWith(".localhost");
}
