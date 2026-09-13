/**
 * PDF-Import über pdf.js.
 *
 * PDF kennt keine Absätze, nur positionierte Textstücke. Rekonstruiert wird aus
 * den Koordinaten: Zeilen (gleiche Grundlinie), Kopf-/Fußzeilen (auf vielen
 * Seiten gleich), Absätze (Einzug, großer Zeilenabstand, kurze Zeile mit
 * Satzende), Überschriften (größere Schrift, zentriert), Silbentrennung am
 * Zeilenende. Mehrspaltensatz und Fußnoten werden nicht gesondert behandelt.
 *
 * pdf.js wird hereingereicht, damit der Kern ohne Umgebungswissen bleibt:
 *   Node:    import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs"
 *   Browser: import * as pdfjs from "pdfjs-dist"  (+ GlobalWorkerOptions.workerSrc)
 */
import type { Doc } from "../pipeline/types.js";
import { splitChapters, type Paragraph } from "./chapters.js";

interface PdfTextItem {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
}

export interface PdfJsLike {
  getDocument(src: { data: Uint8Array; isEvalSupported?: boolean; [key: string]: unknown }): {
    promise: Promise<{
      numPages: number;
      getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }>;
      getMetadata?(): Promise<{ info?: unknown }>;
    }>;
    destroy(): Promise<void>;
  };
}

interface Line {
  text: string;
  x0: number;
  x1: number;
  y: number;
  size: number;
  page: number;
}

const PAGENO = /^\s*[-–—[(]?\s*(?:seite\s+|page\s+)?(\d{1,4}|[ivxlcdm]{1,7})\s*[-–—\])]?\s*$/iu;
const SENTENCE_END = /[.!?…:»«"'”“]\s*$/u;
const HYPHEN_END = /[\p{L}][-­‐‑]$/u;

const median = (xs: number[], fallback: number) => {
  if (!xs.length) return fallback;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

function buildLines(items: unknown[], page: number): Line[] {
  type Part = { x: number; x1: number; str: string; size: number };
  const groups: { y: number; size: number; parts: Part[] }[] = [];
  for (const raw of items) {
    const it = raw as PdfTextItem;
    if (typeof it.str !== "string" || !it.transform || !it.str) continue;
    const [, , c = 0, d = 0, x = 0, y = 0] = it.transform;
    const size = Math.hypot(c, d) || it.height || 10;
    const part = { x, x1: x + (it.width ?? 0), str: it.str, size };
    const g = groups.find((l) => Math.abs(l.y - y) <= Math.max(1.5, 0.45 * Math.min(size, l.size)));
    if (g) {
      g.parts.push(part);
      g.size = Math.max(g.size, size);
    } else {
      groups.push({ y, size, parts: [part] });
    }
  }
  return groups
    .map((g) => {
      const parts = g.parts.sort((a, b) => a.x - b.x);
      let text = "";
      let prev: Part | null = null;
      for (const p of parts) {
        if (prev && p.x - prev.x1 > 0.15 * p.size && !text.endsWith(" ") && !p.str.startsWith(" ")) text += " ";
        text += p.str;
        prev = p;
      }
      return {
        text: text.replace(/\s+/gu, " ").trim(),
        x0: parts[0]!.x,
        x1: Math.max(...parts.map((p) => p.x1)),
        y: g.y,
        size: g.size,
        page,
      };
    })
    .filter((l) => l.text)
    .sort((a, b) => b.y - a.y);
}

/** Kopf-/Fußzeilen und Seitenzahlen entfernen. */
function stripRunning(pages: Line[][]): Line[][] {
  const key = (l: Line) => l.text.replace(/\d+/g, "#").toLowerCase();
  const tops = new Map<string, number>();
  const bottoms = new Map<string, number>();
  for (const p of pages) {
    if (!p.length) continue;
    tops.set(key(p[0]!), (tops.get(key(p[0]!)) ?? 0) + 1);
    bottoms.set(key(p.at(-1)!), (bottoms.get(key(p.at(-1)!)) ?? 0) + 1);
  }
  const thr = Math.max(3, Math.floor(pages.length / 4));
  return pages.map((p) => {
    const lines = [...p];
    while (lines.length && (PAGENO.test(lines[0]!.text) || (tops.get(key(lines[0]!)) ?? 0) >= thr)) lines.shift();
    while (lines.length && (PAGENO.test(lines.at(-1)!.text) || (bottoms.get(key(lines.at(-1)!)) ?? 0) >= thr)) lines.pop();
    return lines;
  });
}

function reflow(pages: Line[][]): Paragraph[] {
  const all = pages.flat();
  if (!all.length) return [];
  const bodySize = median(all.filter((l) => l.text.length > 20).map((l) => Math.round(l.size * 2) / 2), 10);
  const body = all.filter((l) => Math.abs(l.size - bodySize) < bodySize * 0.15);
  // Linker Rand = häufigster Zeilenanfang des Fließtexts
  const starts = new Map<number, number>();
  for (const l of body) starts.set(Math.round(l.x0), (starts.get(Math.round(l.x0)) ?? 0) + 1);
  const margin = [...starts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0;
  const width = median(body.filter((l) => l.text.length > 20).map((l) => l.x1 - margin), 400);
  const gaps: number[] = [];
  for (const p of pages) {
    for (let i = 1; i < p.length; i++) {
      const dy = p[i - 1]!.y - p[i]!.y;
      if (dy > 0 && dy < bodySize * 3) gaps.push(dy);
    }
  }
  const gap = median(gaps, bodySize * 1.2);

  const isHeading = (l: Line) => l.size >= bodySize * 1.2;
  const isCentered = (l: Line) => l.x0 - margin > bodySize * 2 && Math.abs((l.x0 - margin) - (margin + width - l.x1)) < bodySize * 3;

  const out: Paragraph[] = [];
  let cur = "";
  let curHeading = false;
  const flush = () => {
    if (cur.trim()) out.push({ text: cur.trim(), ...(curHeading ? { heading: true } : {}) });
    cur = "";
    curHeading = false;
  };

  for (let i = 0; i < all.length; i++) {
    const line = all[i]!;
    const prev = all[i - 1];
    const heading = isHeading(line);
    const standalone = heading || isCentered(line);
    if (cur && prev) {
      const prevStandalone = isHeading(prev) || isCentered(prev);
      const bigGap = prev.page === line.page && prev.y - line.y > gap * 1.6;
      const indent = line.x0 - margin > bodySize * 0.8 && !standalone;
      const prevShort = prev.x1 - margin < width * 0.72 && SENTENCE_END.test(prev.text);
      const headingRun = standalone && prevStandalone && heading === isHeading(prev) && !bigGap;
      if (!headingRun && (standalone || prevStandalone || bigGap || indent || prevShort)) flush();
    }
    if (!cur) {
      cur = line.text;
      curHeading = heading;
    } else if (HYPHEN_END.test(cur) && /^\p{Ll}/u.test(line.text)) {
      cur = cur.slice(0, -1) + line.text;
    } else {
      cur += " " + line.text;
    }
  }
  flush();
  return out;
}

export async function importPdf(
  bytes: Uint8Array,
  fileName: string,
  pdfjs: PdfJsLike,
  /** Zusätzliche getDocument-Parameter, z. B. `standardFontDataUrl` unter Node. */
  params: Record<string, unknown> = {},
): Promise<Doc> {
  // pdf.js übernimmt den Puffer – Kopie, damit der Aufrufer seine Bytes behält
  const task = pdfjs.getDocument({ ...params, data: bytes.slice(), isEvalSupported: false });
  const pdf = await task.promise;
  try {
    const pages: Line[][] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      pages.push(buildLines((await page.getTextContent()).items, n));
    }
    const info = ((await pdf.getMetadata?.())?.info ?? {}) as { Title?: string; Author?: string; Language?: string };
    const paras = reflow(stripRunning(pages));
    const chapters = splitChapters(paras);
    if (!paras.length) {
      throw new Error("Das PDF enthält keinen auslesbaren Text – vermutlich ein Scan. Texterkennung (OCR) wird noch nicht unterstützt.");
    }
    return {
      meta: {
        title: info.Title?.trim() || fileName.replace(/\.[^.]+$/, ""),
        ...(info.Author?.trim() ? { author: info.Author.trim() } : {}),
        ...(info.Language?.trim() ? { language: info.Language.trim() } : {}),
        source: fileName,
        source_format: "pdf",
      },
      chapters,
    };
  } finally {
    await task.destroy();
  }
}
