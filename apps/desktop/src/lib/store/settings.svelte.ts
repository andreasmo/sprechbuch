/**
 * Lese-Einstellungen – pro Gerät, nicht im Buch (siehe docs/bookfile-format.md).
 */
export type Theme = "auto" | "light" | "sepia" | "dark" | "studio";
export type SpeechDisplay = "marker" | "underline" | "off";

export interface Settings {
  theme: Theme;
  fontSize: number;
  lineHeight: number;
  columnWidth: number;
  speech: SpeechDisplay;
  badges: boolean;
  pipes: boolean;
  wpm: number;
  focus: boolean;
  dimRead: boolean;
  preview: boolean;
}

const KEY = "sprechbuch:settings";
const DEFAULTS: Settings = {
  theme: "auto", fontSize: 21, lineHeight: 1.8, columnWidth: 38, speech: "marker",
  badges: true, pipes: true, wpm: 150, focus: false, dimRead: true, preview: true,
};

function load(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
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

export function resetSettings(): void {
  Object.assign(settings, DEFAULTS);
}
