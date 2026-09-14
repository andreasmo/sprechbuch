/**
 * Retakes, Lesezeichen und Notizen als Liste – für die Nachbearbeitung nach einer Aufnahme.
 */
import type { Book, BookLookup } from "@sprechbuch/core";
import { sentenceAt, sentenceNumbers } from "./render";

export type MarkKind = "retake" | "bookmark" | "note";

export interface MarkRow {
  id: string;
  type: MarkKind;
  chapterIndex: number;
  chapterTitle: string;
  block: string;
  start: number;
  end: number;
  /** Satz im Absatz (für die Leseposition) */
  sentence: number;
  /** laufende Satznummer im Kapitel, ab 1 */
  number: number;
  text: string;
  note: string;
}

const clip = (t: string, max: number) => {
  const s = t.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
};

export function listMarks(book: Book, lookup: BookLookup): MarkRow[] {
  const numbers = new Map<string, Map<string, number>>();
  const rows: MarkRow[] = [];
  for (const a of book.annotations) {
    if (a.type !== "retake" && a.type !== "bookmark" && a.type !== "note") continue;
    const ref = lookup.blocks.get(a.block);
    if (!ref) continue;
    let nums = numbers.get(ref.chapter.id);
    if (!nums) numbers.set(ref.chapter.id, (nums = sentenceNumbers(ref.chapter)));
    const sentence = sentenceAt(ref.block, a.start);
    rows.push({
      id: a.id,
      type: a.type,
      chapterIndex: ref.chapterIndex,
      chapterTitle: ref.chapter.title,
      block: a.block,
      start: a.start,
      end: a.end,
      sentence,
      number: (nums.get(a.block) ?? 1) + sentence,
      text: clip(ref.block.text.slice(a.start, a.end), 160),
      note: a.type === "note" ? a.text : a.type === "retake" ? (a.note ?? "") : "",
    });
  }
  return rows.sort((x, y) => (lookup.order.get(x.block) ?? 0) - (lookup.order.get(y.block) ?? 0) || x.start - y.start);
}

const KIND_LABEL: Record<MarkKind, string> = { retake: "Retake", bookmark: "Lesezeichen", note: "Notiz" };

/** CSV mit Semikolon und BOM – öffnet sich in deutschem Excel/LibreOffice ohne Importdialog. */
export function marksToCsv(rows: MarkRow[]): string {
  const cell = (v: string | number) => {
    const s = String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    ["Art", "Kapitel", "Kapiteltitel", "Satz", "Text", "Notiz"],
    ...rows.map((r) => [KIND_LABEL[r.type], r.chapterIndex + 1, r.chapterTitle, r.number, r.text, r.note]),
  ];
  return "﻿" + lines.map((l) => l.map(cell).join(";")).join("\r\n") + "\r\n";
}

/** Kurzfassung für die Zwischenablage, eine Zeile pro Markierung. */
export function marksToText(rows: MarkRow[]): string {
  return rows.map((r) => `${KIND_LABEL[r.type]} · Kap. ${r.chapterIndex + 1}, Satz ${r.number}: ${r.text}${r.note ? ` – ${r.note}` : ""}`).join("\n");
}
