/**
 * KI-Anbieter: zwei Protokolle decken praktisch alles ab.
 *
 * - `anthropic`: Anthropic Messages API mit strukturierten Antworten (`output_config.format`).
 * - `openai`: OpenAI-kompatibles `/chat/completions` – OpenAI, OpenRouter, Mistral, Groq,
 *   Azure OpenAI, aber auch lokale Server wie Ollama, LM Studio oder vLLM.
 *
 * Schlüssel stehen nie in dieser Konfiguration. Sie liegen im Tresor des Betriebssystems und
 * werden erst im Transport (Desktop: Rust) an die Anfrage gehängt.
 */

export type ProviderKind = "anthropic" | "openai";
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
}

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
    kind: "openai",
    baseUrl: "http://localhost:11434/v1",
    needsKey: false,
    local: true,
    models: [],
    defaultModel: "",
    hint: "Ollama installieren und ein Modell laden (z. B. „ollama pull qwen3“). Der Text bleibt auf diesem Rechner.",
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
    hint: "In LM Studio ein Modell laden und den lokalen Server starten. Der Text bleibt auf diesem Rechner.",
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
  };
}

export const authStyle = (config: Pick<ProviderConfig, "kind" | "needsKey">): AuthStyle =>
  !config.needsKey ? "none" : config.kind === "anthropic" ? "x-api-key" : "bearer";

/** Basis-URL ohne abschließenden Schrägstrich */
export const normalizeBaseUrl = (url: string) => url.trim().replace(/\/+$/, "");

/** Host für den Datenschutzhinweis („Text geht an api.anthropic.com“) */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Läuft der Endpunkt auf diesem Rechner oder im lokalen Netz? */
export function isLocalUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname.replace(/^\[|\]$/g, "");
    return h === "localhost" || h === "::1" || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h.endsWith(".local");
  } catch {
    return false;
  }
}
