/**
 * Lese-Einstellungen – pro Gerät, nicht im Buch (siehe docs/bookfile-format.md).
 */
import { penSlot } from "@sprechbuch/core";
export type Theme = "auto" | "light" | "sepia" | "dark" | "studio";
export type SpeechDisplay = "marker" | "underline" | "off";
export type ReadFont = "serif" | "sans" | "legible" | "mono";

export interface Settings {
  theme: Theme;
  font: ReadFont;
  fontSize: number;
  lineHeight: number;
  columnWidth: number;
  /** zusätzlicher Wortabstand in em */
  wordSpacing: number;
  speech: SpeechDisplay;
  badges: boolean;
  pipes: boolean;
  /** Atemstellen an Kommata, Semikola, Doppelpunkten */
  breath: boolean;
  /** lange Sätze unterstreichen */
  warnLong: boolean;
  numbers: boolean;
  wpm: number;
  focus: boolean;
  dimRead: boolean;
  preview: boolean;
  legend: boolean;
  /** Seitenmodus (Blättern) statt Scrollen im Aufnahmemodus */
  paged: boolean;
  /** Desktop: Änderungen selbsttätig in die .hbook-Datei schreiben, sobald sie einen Speicherort hat */
  autosaveFile: boolean;
  /** Stiftfarbe für neue Betonungen (Index in PEN_SLOTS), null = schlicht */
  penColor: number | null;
  /** Auf diesem Gerät wurde schon mit einem Stift gearbeitet – dann Farbwahl und Stift-Hinweise zeigen */
  penSeen: boolean;
}

const KEY = "sprechbuch:settings";
export const DEFAULTS: Settings = {
  theme: "auto", font: "serif", fontSize: 21, lineHeight: 1.8, columnWidth: 38, wordSpacing: 0, speech: "marker",
  badges: true, pipes: true, breath: false, warnLong: false, numbers: false, wpm: 150, focus: false, dimRead: true,
  preview: true, legend: true, paged: false, autosaveFile: true, penColor: null, penSeen: false,
};

export const FONT_STACK: Record<ReadFont, string> = {
  serif: `"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif`,
  sans: `"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif`,
  legible: `"Atkinson Hyperlegible", "OpenDyslexic", Verdana, Tahoma, sans-serif`,
  mono: `ui-monospace, "Cascadia Mono", Consolas, "DejaVu Sans Mono", monospace`,
};

function load(): Settings {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Settings>;
    const merged = { ...DEFAULTS, ...stored };
    // Unbekannte Werte aus älteren Versionen nicht übernehmen
    if (!(merged.font in FONT_STACK)) merged.font = DEFAULTS.font;
    if (penSlot(merged.penColor) === null) merged.penColor = null;
    return merged;
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings: Settings = $state(load());

$effect.root(() => {
  $effect(() => {
    const snapshot = JSON.stringify(settings);
    try {
      localStorage.setItem(KEY, snapshot);
    } catch {
      /* privater Modus o. Ä. – Einstellungen gelten dann nur für die Sitzung */
    }
  });
  $effect(() => {
    document.documentElement.dataset.theme = settings.theme;
  });
});

/** Darstellung zurücksetzen – das Speicherverhalten bleibt, wie es ist */
export function resetSettings(): void {
  Object.assign(settings, { ...DEFAULTS, autosaveFile: settings.autosaveFile, penSeen: settings.penSeen });
}

export const THEMES: [Theme, string][] = [["auto", "Automatisch"], ["light", "Hell"], ["sepia", "Sepia"], ["dark", "Dunkel"], ["studio", "Studio"]];

export function nextTheme(): void {
  settings.theme = THEMES[(THEMES.findIndex(([t]) => t === settings.theme) + 1) % THEMES.length]![0];
}
