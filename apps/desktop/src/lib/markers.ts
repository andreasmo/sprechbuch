import { MARKER_MISC, MARKER_SLOTS } from "@sprechbuch/core";

/**
 * Markerfarben als CSS-Variablen – die Palette lebt nur im Kern.
 * Dunkle Themen (dunkel, Studio, »auto« bei dunklem System) nutzen die dunklen Töne.
 */
export function injectMarkerCss(): void {
  if (document.getElementById("marker-css")) return;
  const light = MARKER_SLOTS.map((s, i) => `--m${i}:${s.light};--ms${i}:${s.strongLight};`).join("")
    + `--mx:${MARKER_MISC.light};--msx:${MARKER_MISC.strongLight};`;
  const dark = MARKER_SLOTS.map((s, i) => `--m${i}:${s.dark};--ms${i}:${s.strongDark};`).join("")
    + `--mx:${MARKER_MISC.dark};--msx:${MARKER_MISC.strongDark};`;
  const style = document.createElement("style");
  style.id = "marker-css";
  style.textContent = `:root{${light}}
:root[data-theme="dark"],:root[data-theme="studio"]{${dark}}
@media (prefers-color-scheme: dark){:root[data-theme="auto"]{${dark}}}`;
  document.head.appendChild(style);
}

export const markVar = (slot: number | null | undefined) => (slot === null || slot === undefined ? "var(--mx)" : `var(--m${slot})`);
export const strongVar = (slot: number | null | undefined) => (slot === null || slot === undefined ? "var(--msx)" : `var(--ms${slot})`);
