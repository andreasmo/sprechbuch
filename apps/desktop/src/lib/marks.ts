/**
 * Retakes, Lesezeichen, Notizen und Betonungen als Liste – für die Nachbearbeitung nach einer Aufnahme.
 */
import { penSlot, type Book, type BookLookup, type Ink } from "@sprechbuch/core";
import { penName } from "./markers";
import { sentenceAt, sentenceNumbers } from "./render";

export type MarkKind = "retake" | "bookmark" | "note" | "emphasis";
export const MARK_KINDS: readonly MarkKind[] = ["retake", "bookmark", "note", "emphasis"];

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
  /** Handschrift einer Notiz */
  ink?: Ink;
  /** Betonung: Stiftfarbe (null = schlicht) und ihr Name mit Bedeutung, z. B. „Rot – langsamer“ */
  color?: number | null;
  pen?: string;
}

const clip = (t: string, max: number) => {
  const s = t.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
};

export function listMarks(book: Book, lookup: BookLookup): MarkRow[] {
  const numbers = new Map<string, Map<string, number>>();
  const rows: MarkRow[] = [];
  for (const a of book.annotations) {
    if (a.type !== "retake" && a.type !== "bookmark" && a.type !== "note" && a.type !== "emphasis") continue;
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
      ...(a.type === "note" && a.ink ? { ink: a.ink } : {}),
      ...(a.type === "emphasis" ? { color: penSlot(a.color), pen: penName(a.color, book.emphasisLabels) } : {}),
    });
  }
  return rows.sort((x, y) => (lookup.order.get(x.block) ?? 0) - (lookup.order.get(y.block) ?? 0) || x.start - y.start);
}

const KIND_LABEL: Record<MarkKind, string> = { retake: "Retake", bookmark: "Lesezeichen", note: "Notiz", emphasis: "Betonung" };

/** Notiz für Export und Zwischenablage – reine Handschrift wird als solche benannt */
const noteText = (r: MarkRow) => r.note || (r.ink ? "(Handschrift)" : "");

/** CSV mit Semikolon und BOM – öffnet sich in deutschem Excel/LibreOffice ohne Importdialog. */
export function marksToCsv(rows: MarkRow[]): string {
  const cell = (v: string | number) => {
    const s = String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    ["Art", "Kapitel", "Kapiteltitel", "Satz", "Text", "Notiz", "Farbe"],
    ...rows.map((r) => [KIND_LABEL[r.type], r.chapterIndex + 1, r.chapterTitle, r.number, r.text, noteText(r), r.pen ?? ""]),
  ];
  return "﻿" + lines.map((l) => l.map(cell).join(";")).join("\r\n") + "\r\n";
}

/** Kurzfassung für die Zwischenablage, eine Zeile pro Markierung. */
export function marksToText(rows: MarkRow[]): string {
  return rows.map((r) => {
    const kind = r.pen && r.color !== null ? `${KIND_LABEL[r.type]} (${r.pen})` : KIND_LABEL[r.type];
    const note = noteText(r);
    return `${kind} · Kap. ${r.chapterIndex + 1}, Satz ${r.number}: ${r.text}${note ? ` – ${note}` : ""}`;
  }).join("\n");
}
