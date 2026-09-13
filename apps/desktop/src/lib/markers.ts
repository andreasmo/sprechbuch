import { MARKER_MISC, MARKER_SLOTS } from "@sprechbuch/core";

/** Markerfarben als CSS-Variablen – Palette lebt nur im Kern, nicht doppelt im Stylesheet. */
export function injectMarkerCss(): void {
  if (document.getElementById("marker-css")) return;
  const light = MARKER_SLOTS.map((s, i) => `--m${i}:${s.light};--ms${i}:${s.strongLight};`).join("");
  const dark = MARKER_SLOTS.map((s, i) => `--m${i}:${s.dark};--ms${i}:${s.strongDark};`).join("");
  const style = document.createElement("style");
  style.id = "marker-css";
  style.textContent = `:root{${light}--mx:${MARKER_MISC.light};--msx:${MARKER_MISC.strongLight};}
@media (prefers-color-scheme: dark){:root{${dark}--mx:${MARKER_MISC.dark};--msx:${MARKER_MISC.strongDark};}}`;
  document.head.appendChild(style);
}

export const markVar = (slot: number | null | undefined) => (slot === null || slot === undefined ? "var(--mx)" : `var(--m${slot})`);
export const strongVar = (slot: number | null | undefined) => (slot === null || slot === undefined ? "var(--msx)" : `var(--ms${slot})`);
