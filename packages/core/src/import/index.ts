import JSZip from "jszip";
import { createBook } from "../book/create.js";
import type { Book, SourceFormat } from "../book/schema.js";
import type { AnalyzeOptions } from "../pipeline/analyze.js";
import { findSpeech } from "../pipeline/dialogue.js";
import { assignColors } from "../pipeline/palette.js";
import { segmentDoc } from "../pipeline/segment.js";
import { attributeSpeakers } from "../pipeline/speakers.js";
import type { Doc } from "../pipeline/types.js";
import { wordCount } from "../text.js";
import { importEpub } from "./epub.js";
import { importPdf, type PdfJsLike } from "./pdf.js";

export class UnsupportedFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedFormatError";
  }
}

const startsWith = (b: Uint8Array, s: string) => [...s].every((c, i) => b[i] === c.charCodeAt(0));

/** Erkennt das Eingabeformat am Inhalt, nicht an der Dateiendung. */
export async function detectFormat(bytes: Uint8Array, fileName = ""): Promise<SourceFormat | null> {
  if (startsWith(bytes, "%PDF-")) return "pdf";
  if (startsWith(bytes, "PK")) {
    try {
      const zip = await JSZip.loadAsync(bytes);
      const mt = await zip.file("mimetype")?.async("string");
      if (mt?.trim() === "application/epub+zip" || zip.file("META-INF/container.xml")) return "epub";
      if (zip.file("word/document.xml")) return "docx";
    } catch {
      return null;
    }
  }
  const ext = fileName.toLowerCase().split(".").pop();
  return ext === "epub" || ext === "pdf" || ext === "docx" ? ext : null;
}

export interface ChapterFilter {
  /** Kapitelauswahl, z. B. "2-13" oder "1,3,5-7" (1-basiert). */
  range?: string;
  /** Kapitel mit weniger Wörtern verwerfen (Titelei, Impressum). */
  minWords?: number;
}

export function filterChapters(doc: Doc, f: ChapterFilter): Doc {
  if (f.range) {
    const n = doc.chapters.length;
    const keep = new Set<number>();
    for (const part of f.range.split(",").map((p) => p.trim()).filter(Boolean)) {
      const [a, b] = part.includes("-") ? part.split("-") : [part, part];
      for (let i = Number(a || 1); i <= Number(b || n); i++) keep.add(i);
    }
    doc.chapters = doc.chapters.filter((_, i) => keep.has(i + 1));
  }
  if (f.minWords) {
    doc.chapters = doc.chapters.filter((c) => c.blocks.reduce((s, b) => s + wordCount(b.text), 0) >= f.minWords!);
  }
  return doc;
}

export type ImportStage = "read" | "sentences" | "speech" | "speakers" | "colors" | "book";

export interface ImportOptions extends AnalyzeOptions, ChapterFilter {
  /** pdf.js-Modul – nur für PDF nötig. */
  pdfjs?: PdfJsLike;
  /** Zusätzliche pdf.js-getDocument-Parameter (z. B. standardFontDataUrl unter Node). */
  pdfjsParams?: Record<string, unknown>;
  /** Originaldatei in der .hbook mitspeichern (Standard: ja). */
  embedSource?: boolean;
  onProgress?: (stage: ImportStage) => void;
}

export interface ImportResult {
  book: Book;
  doc: Doc;
}

/** Datei → Analyse → Buchdatei. Der eine Einstiegspunkt für App und CLI. */
export async function importBook(bytes: Uint8Array, fileName: string, opts: ImportOptions = {}): Promise<ImportResult> {
  const progress = opts.onProgress ?? (() => {});
  const format = await detectFormat(bytes, fileName);
  progress("read");
  let doc: Doc;
  switch (format) {
    case "epub":
      doc = await importEpub(bytes, fileName);
      break;
    case "pdf":
      if (!opts.pdfjs) throw new UnsupportedFormatError("Für PDF-Dateien muss pdf.js übergeben werden.");
      doc = await importPdf(bytes, fileName, opts.pdfjs, opts.pdfjsParams);
      break;
    case "docx":
      throw new UnsupportedFormatError("Word-Dateien (.docx) werden noch nicht unterstützt – bitte als PDF oder EPUB speichern.");
    default:
      throw new UnsupportedFormatError(`Unbekanntes Dateiformat: ${fileName}. Unterstützt werden EPUB und PDF.`);
  }
  filterChapters(doc, opts);
  if (!doc.chapters.length) throw new UnsupportedFormatError("Nach dem Import ist kein Text übrig.");

  progress("sentences");
  segmentDoc(doc);
  progress("speech");
  findSpeech(doc, opts.quoteStyle);
  progress("speakers");
  attributeSpeakers(doc, opts.cast);
  progress("colors");
  assignColors(doc, opts);
  progress("book");
  const book = await createBook(doc, { fileName, format, bytes, embedded: opts.embedSource ?? true });
  return { book, doc };
}
