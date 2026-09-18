/**
 * Farbvergabe pro Figur (Textmarker).
 *
 * Zwei Ebenen: Der Hauptcast bekommt buchweit feste Slots; Nebenfiguren
 * bekommen pro Kapitel einen dort freien Slot. So ist innerhalb eines Kapitels
 * keine Farbe doppelt vergeben, und Hauptfiguren behalten ihre Farbe im ganzen
 * Buch. Redundanz zur Farbe liefert das Initialen-Kürzel.
 */
import { capitalize, splitWs } from "../text.js";
import type { CastMember, Doc } from "./types.js";

export interface MarkerSlot {
  name: string;
  /** Markerband im hellen Thema */
  light: string;
  /** Markerband im dunklen Thema */
  dark: string;
  /** Kräftiger Ton für Kürzel und Ränder (hell / dunkel) */
  strongLight: string;
  strongDark: string;
}

/** Reihenfolge = Vergabereihenfolge: die am besten unterscheidbaren zuerst. */
export const MARKER_SLOTS: readonly MarkerSlot[] = [
  { name: "Gelb", light: "#fff27a", dark: "#4d4300", strongLight: "#8a6d00", strongDark: "#f2d64b" },
  { name: "Grün", light: "#bff5b0", dark: "#1e4520", strongLight: "#2e7d32", strongDark: "#86d98a" },
  { name: "Pink", light: "#ffc6e6", dark: "#561c3b", strongLight: "#b0276f", strongDark: "#ff94cb" },
  { name: "Blau", light: "#b8dfff", dark: "#173a63", strongLight: "#1f5fb8", strongDark: "#8cc4ff" },
  { name: "Orange", light: "#ffd5a1", dark: "#5a3310", strongLight: "#b35900", strongDark: "#ffb066" },
  { name: "Lila", light: "#ddcbff", dark: "#35265e", strongLight: "#6a3fc2", strongDark: "#c0a3ff" },
  { name: "Türkis", light: "#aef1e6", dark: "#124640", strongLight: "#0b7a6e", strongDark: "#66dccb" },
  { name: "Limette", light: "#e6f7a0", dark: "#3a4812", strongLight: "#5c7a00", strongDark: "#cbe45f" },
  { name: "Koralle", light: "#ffc0b8", dark: "#57201c", strongLight: "#b3261e", strongDark: "#ff958b" },
  { name: "Himmel", light: "#cfd8ff", dark: "#27305a", strongLight: "#3f51b5", strongDark: "#a5b4ff" },
  { name: "Sand", light: "#eedfb9", dark: "#473a22", strongLight: "#7a5c1f", strongDark: "#dcc38c" },
  { name: "Mauve", light: "#ecd0e5", dark: "#4a2c43", strongLight: "#8a4a7a", strongDark: "#e0a8d2" },
];

export const MARKER_MISC: MarkerSlot = {
  name: "Neben", light: "#e2e5ea", dark: "#2c323a", strongLight: "#5c6470", strongDark: "#a4adba",
};

/**
 * Stiftfarben für Betonungen. Bewusst kräftige Linientöne statt der Markerbänder der Figuren, und jede
 * Farbe mit eigener Linienart – so bleiben Betonungen auch ohne Farbe unterscheidbar (Studio-Thema,
 * Farbsehschwäche, Schwarzweißdruck). Gewellt in Rot wäre ein Retake, deshalb ist Rot doppelt.
 */
export interface PenSlot {
  name: string;
  line: "double" | "wavy" | "dotted" | "dashed" | "solid";
  /** Linienfarbe im hellen / dunklen Thema */
  light: string;
  dark: string;
}

export const PEN_SLOTS: readonly PenSlot[] = [
  { name: "Rot", line: "double", light: "#c62828", dark: "#ff8a80" },
  { name: "Blau", line: "wavy", light: "#1565c0", dark: "#82b1ff" },
  { name: "Grün", line: "dotted", light: "#2e7d32", dark: "#69f0ae" },
  { name: "Orange", line: "dashed", light: "#d84315", dark: "#ffab40" },
  { name: "Violett", line: "solid", light: "#6a1b9a", dark: "#ea80fc" },
];

/** Stiftfarbe einer Betonung – unbekannte Indizes (neuere Version) gelten als schlicht. */
export const penSlot = (color: number | null | undefined): number | null =>
  color !== null && color !== undefined && Number.isInteger(color) && color >= 0 && color < PEN_SLOTS.length ? color : null;

export function initials(name: string): string {
  const parts = splitWs(name.replace(/-/g, " ")).filter((p) => /^\p{L}/u.test(p));
  if (!parts.length) return "?";
  if (parts.length === 1) return capitalize(parts[0]!.slice(0, 2));
  return (parts[0]![0]! + parts.at(-1)![0]!).toUpperCase();
}

export interface PaletteOptions {
  /** Ab so vielen Redeteilen bekommt eine Figur eine buchweit feste Farbe. */
  mainMinLines?: number;
  maxMain?: number;
}

const isSlot = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

export function assignColors(doc: Doc, opts: PaletteOptions = {}): Doc {
  const mainMinLines = opts.mainMinLines ?? 4;
  const maxMain = opts.maxMain ?? MARKER_SLOTS.length;
  const cast: CastMember[] = doc.cast ?? [];
  const byId = new Map(cast.map((c) => [c.id, c]));

  // 1) Hauptcast. Vorgaben werden respektiert; doppelte Vorgaben löst die
  //    redestärkere Figur für sich, die andere rückt auf einen freien Slot.
  const forced = cast.filter((c) => isSlot(c.color)).sort((a, b) => b.lines - a.lines);
  const used = new Set<number>();
  for (const c of forced) {
    const want = c.color as number;
    if (want >= 0 && want < MARKER_SLOTS.length && !used.has(want)) {
      c.slot = want;
      used.add(want);
    } else {
      c.slot = null;
    }
  }
  const rest = cast.filter((c) => c.lines >= mainMinLines && !isSlot(c.color));
  const main = [...forced, ...rest.slice(0, Math.max(0, maxMain - forced.length))];
  const free = MARKER_SLOTS.map((_, i) => i).filter((i) => !used.has(i));
  for (const c of main) {
    if (c.slot === undefined || c.slot === null) c.slot = free.shift() ?? null;
    c.badge ||= initials(c.name);
  }
  for (const c of cast) {
    c.slot ??= null;
    c.badge ||= initials(c.name);
    c.color = c.slot;
  }

  // 2) Nebenfiguren – ein Slot pro Kapitel, ohne Kollision
  const chapterColors: Record<string, Record<string, number | null>> = {};
  for (const ch of doc.chapters) {
    const order: string[] = [];
    for (const b of ch.blocks) {
      for (const sp of b.speech ?? []) {
        if (sp.speaker && !order.includes(sp.speaker)) order.push(sp.speaker);
      }
    }
    const taken = new Set(order.map((id) => byId.get(id)?.slot).filter(isSlot));
    const pool = MARKER_SLOTS.map((_, i) => i).filter((i) => !taken.has(i));
    const local: Record<string, number | null> = {};
    for (const id of order) {
      const c = byId.get(id);
      if (!c || c.slot !== null) continue;
      local[id] = pool.shift() ?? null;
    }
    chapterColors[ch.id] = local;
  }
  doc.chapter_colors = chapterColors;
  return doc;
}
