import { findSpeech } from "./dialogue.js";
import { assignColors, type PaletteOptions } from "./palette.js";
import { segmentDoc } from "./segment.js";
import { attributeSpeakers } from "./speakers.js";
import type { CastPreset, Doc, QuoteStyle } from "./types.js";

export interface AnalyzeOptions extends PaletteOptions {
  /** Anführungsstil erzwingen (sonst automatisch erkannt). */
  quoteStyle?: QuoteStyle;
  /** Figurenvorgaben – Namen, Aliasse, feste Farben. */
  cast?: CastPreset[];
}

/** Komplette Regel-Analyse: Sätze → direkte Rede → Sprecher → Farben. */
export function analyze(doc: Doc, opts: AnalyzeOptions = {}): Doc {
  segmentDoc(doc);
  findSpeech(doc, opts.quoteStyle);
  attributeSpeakers(doc, opts.cast);
  assignColors(doc, opts);
  return doc;
}
