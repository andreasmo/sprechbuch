import type { Chapter } from "../pipeline/types.js";

const CH_HEAD = /^\s*((?:kapitel|abschnitt|teil|buch|chapter|part|book)\s+[\dIVXLC]+|[IVXLC]{1,7}\.?|\d{1,3}\.?)\s*[.:–—-]?\s*(.{0,60})$/iu;

export interface Paragraph {
  text: string;
  /** Vom Importer als Überschrift erkannt (z. B. größere Schrift im PDF). */
  heading?: boolean;
}

/** Absätze in Kapitel schneiden – Überschrift = erkannte Überschrift oder kurze Zeile im Kapitelmuster. */
export function splitChapters(paras: Paragraph[]): Chapter[] {
  const chapters: Chapter[] = [];
  let blocks: Chapter["blocks"] = [];
  let title = "";
  const push = () => {
    if (!blocks.length) return;
    const n = chapters.length + 1;
    chapters.push({ id: `ch${String(n).padStart(3, "0")}`, src: "", title: title || `Kapitel ${n}`, blocks });
  };
  for (const p of paras) {
    const isHead = p.text.length < 80 && (p.heading || CH_HEAD.test(p.text));
    if (isHead && !(p.heading && blocks.length && blocks.every((b) => b.type === "h1"))) {
      push();
      blocks = [];
      title = p.text.trim();
      blocks.push({ type: "h1", text: p.text, marks: [] });
    } else if (isHead) {
      // Mehrzeilige Überschrift (»Kapitel 3« + »Der Fluss«) bleibt zusammen
      blocks.push({ type: "h2", text: p.text, marks: [] });
      title = `${title} – ${p.text.trim()}`;
    } else {
      blocks.push({ type: "p", text: p.text, marks: [] });
    }
  }
  push();
  return chapters;
}
