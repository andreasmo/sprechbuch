import type { Annotation } from "@sprechbuch/core";

export const VIA_LABEL: Record<string, string> = {
  inquit_after: "Inquit nach der Rede",
  inquit_before: "Inquit vor der Rede",
  same_paragraph: "gleicher Absatz",
  continuation: "Fortsetzung",
  pronoun: "Pronomen aufgelöst",
  inquit_paragraph: "Inquit weiter vorn im Absatz",
  proximity: "Nähe – geraten",
  alternation: "Wechselrede – geraten",
  unknown: "keine Zuordnung",
  user: "von dir festgelegt",
};

export const MARK_LABEL: Record<Annotation["type"], string> = {
  speech: "Rede",
  quote: "Zitat in der Rede",
  emphasis: "Betonung",
  retake: "Retake",
  bookmark: "Lesezeichen",
  note: "Notiz",
  pause: "Pause",
  breath: "Atemzeichen",
};

export function viaLabel(a: Extract<Annotation, { type: "speech" }>): string {
  if (a.origin === "user") return VIA_LABEL.user!;
  return VIA_LABEL[a.via ?? "unknown"] ?? a.via ?? "";
}

export const fmt = (n: number) => n.toLocaleString("de-DE");

export function duration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

/** Tastenkürzel nicht auslösen, während in ein Feld getippt wird. */
export function isTyping(ev: Event): boolean {
  const t = ev.target;
  return t instanceof Element && !!t.closest("input, textarea, select, [contenteditable]");
}
