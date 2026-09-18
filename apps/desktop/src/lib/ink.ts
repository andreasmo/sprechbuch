/**
 * Stift: Striche aufbereiten und Gesten erkennen – reine Funktionen ohne DOM.
 *
 * Handschrift wird auf die Breite der Schreibfläche normiert (0–1000, y in derselben Einheit).
 * So zeigt der Rand dieselbe Schrift bei jeder Schriftgröße, nur größer oder kleiner.
 */
import type { Ink } from "@sprechbuch/core";

export interface Pt {
  x: number;
  y: number;
}

/** Normierte Breite der Schreibfläche */
export const INK_WIDTH = 1000;
/** Linienabstand auf dem Schreibblatt – ergibt im Rand ungefähr die Zeilenhöhe getippter Notizen */
export const INK_LINE = 140;
/** Strichstärke in Tausendsteln der Breite */
export const INK_STROKE = 12;
/** Abweichung, unterhalb der Zwischenpunkte wegfallen (in Tausendsteln der Breite) */
const SIMPLIFY = 1.2;

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Abstand eines Punktes von der Strecke a–b */
function segmentDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (!len2) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Ramer–Douglas–Peucker: Punkte weglassen, die weniger als `tol` von der Linie abweichen */
export function simplify(points: readonly Pt[], tol: number): Pt[] {
  if (points.length <= 2) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segmentDistance(points[i]!, points[a]!, points[b]!);
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (worst > tol) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * Striche in normierten Einheiten → gespeicherte Handschrift. Oben und unten wird auf die Schrift
 * zugeschnitten, waagerecht nicht – so bleibt die Schriftgröße über alle Notizen gleich.
 */
export function toInk(strokes: readonly (readonly Pt[])[]): Ink | null {
  const kept = strokes.filter((s) => s.length > 0).map((s) => simplify(s, SIMPLIFY));
  if (!kept.length) return null;
  const pad = INK_STROKE;
  const top = Math.min(...kept.flat().map((p) => p.y)) - pad;
  const out = kept.map((s) => {
    const flat: number[] = [];
    for (const p of s) flat.push(Math.max(0, Math.min(INK_WIDTH, Math.round(p.x))), Math.max(0, Math.round(p.y - top)));
    // Ein Tipp ist ein Punkt – als Strich mit zwei gleichen Punkten
    if (flat.length === 2) flat.push(flat[0]!, flat[1]!);
    return flat;
  });
  const bottom = Math.max(...out.flatMap((s) => s.filter((_, i) => i % 2 === 1)));
  return { h: Math.max(Math.round(INK_LINE / 2), bottom + pad), w: INK_STROKE, strokes: out };
}

/** Gespeicherte Handschrift → Striche in normierten Einheiten */
export function fromInk(ink: Ink): Pt[][] {
  return ink.strokes.map((s) => {
    const pts: Pt[] = [];
    for (let i = 0; i + 1 < s.length; i += 2) pts.push({ x: s[i]!, y: s[i + 1]! });
    return pts;
  });
}

/** SVG-Pfad eines Strichs, geglättet über die Mittelpunkte */
export function inkPath(stroke: readonly number[]): string {
  const n = stroke.length / 2;
  if (n < 1) return "";
  const x = (i: number) => stroke[2 * i]!;
  const y = (i: number) => stroke[2 * i + 1]!;
  if (n <= 2) return `M${x(0)} ${y(0)}L${x(n - 1)} ${y(n - 1)}`;
  let d = `M${x(0)} ${y(0)}`;
  for (let i = 1; i < n - 1; i++) {
    const mx = (x(i) + x(i + 1)) / 2;
    const my = (y(i) + y(i + 1)) / 2;
    d += `Q${x(i)} ${y(i)} ${mx} ${my}`;
  }
  return `${d}L${x(n - 1)} ${y(n - 1)}`;
}

/** Striche, die der Radierer auf seinem Weg berührt (Index) */
export function touchedStrokes(strokes: readonly (readonly Pt[])[], path: readonly Pt[], radius: number): Set<number> {
  const hit = new Set<number>();
  strokes.forEach((s, i) => {
    for (const p of path) {
      const near = s.length === 1
        ? dist(p, s[0]!) <= radius
        : s.some((q, j) => j > 0 && segmentDistance(p, s[j - 1]!, q) <= radius);
      if (near) {
        hit.add(i);
        return;
      }
    }
  });
  return hit;
}

export interface Strike {
  x1: number;
  x2: number;
  /** Mittlere Höhe des Strichs */
  y: number;
}

/**
 * Waagerechter Strich durch oder unter Wörtern? Im Zweifel nicht – eine falsch erkannte Geste
 * schadet mehr als eine, die man wiederholen muss. Maße in Bildschirmpixeln.
 */
export function classifyStrike(points: readonly Pt[], fontPx: number, linePx: number): Strike | null {
  if (points.length < 2) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x1 = Math.min(...xs);
  const x2 = Math.max(...xs);
  const w = x2 - x1;
  const h = Math.max(...ys) - Math.min(...ys);
  if (w < fontPx * 1.2) return null;
  if (h > linePx * 0.75 || h > w * 0.35) return null;
  // Hin und her (Kritzeln, Durchstreichen mit Schleifen) ist kein Strich
  let length = 0;
  for (let i = 1; i < points.length; i++) length += dist(points[i - 1]!, points[i]!);
  if (length > w * 1.6) return null;
  const sorted = [...ys].sort((a, b) => a - b);
  return { x1, x2, y: sorted[Math.floor(sorted.length / 2)]! };
}
