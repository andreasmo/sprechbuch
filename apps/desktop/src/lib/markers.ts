import { MARKER_MISC, MARKER_SLOTS, PEN_SLOTS, penSlot, type PenSlot } from "@sprechbuch/core";

/**
 * Marker- und Stiftfarben als CSS-Variablen – die Paletten leben nur im Kern.
 * Dunkle Themen (dunkel, Studio, »auto« bei dunklem System) nutzen die dunklen Töne.
 */
export function injectMarkerCss(): void {
  if (document.getElementById("marker-css")) return;
  const light = MARKER_SLOTS.map((s, i) => `--m${i}:${s.light};--ms${i}:${s.strongLight};`).join("")
    + `--mx:${MARKER_MISC.light};--msx:${MARKER_MISC.strongLight};`
    + PEN_SLOTS.map((p, i) => `--pen${i}:${p.light};`).join("");
  const dark = MARKER_SLOTS.map((s, i) => `--m${i}:${s.dark};--ms${i}:${s.strongDark};`).join("")
    + `--mx:${MARKER_MISC.dark};--msx:${MARKER_MISC.strongDark};`
    + PEN_SLOTS.map((p, i) => `--pen${i}:${p.dark};`).join("");
  const style = document.createElement("style");
  style.id = "marker-css";
  style.textContent = `:root{${light}}
:root[data-theme="dark"],:root[data-theme="studio"]{${dark}}
@media (prefers-color-scheme: dark){:root[data-theme="auto"]{${dark}}}`;
  document.head.appendChild(style);
}

export const markVar = (slot: number | null | undefined) => (slot === null || slot === undefined ? "var(--mx)" : `var(--m${slot})`);
export const strongVar = (slot: number | null | undefined) => (slot === null || slot === undefined ? "var(--msx)" : `var(--ms${slot})`);

/** Punkte und Striche brauchen mehr Stärke, damit man sie auf einen Blick erkennt */
const PEN_THICK: Record<PenSlot["line"], string> = { double: "0.13em", wavy: "0.09em", dotted: "0.17em", dashed: "0.13em", solid: "0.19em" };

/** Unterstrich einer Betonung als CSS-Variablen (für `.emph`); leer = schlicht */
export function penStyle(color: number | null | undefined): string {
  const i = penSlot(color);
  if (i === null) return "";
  const line = PEN_SLOTS[i]!.line;
  return `--pen: var(--pen${i}); --pen-line: ${line}; --pen-thick: ${PEN_THICK[line]}`;
}

/** Farbe als Name mit Bedeutung, z. B. „Rot – langsamer“ */
export function penName(color: number | null | undefined, labels: readonly string[] | undefined): string {
  const i = penSlot(color);
  if (i === null) return "schlicht";
  const label = labels?.[i]?.trim();
  return label ? `${PEN_SLOTS[i]!.name} – ${label}` : PEN_SLOTS[i]!.name;
}
