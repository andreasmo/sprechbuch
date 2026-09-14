export { VERSION } from "./version.js";
export * from "./text.js";

// Analyse-Pipeline (internes Arbeitsmodell)
export type * from "./pipeline/types.js";
export { analyze, type AnalyzeOptions } from "./pipeline/analyze.js";
export { detectQuoteStyle, findSpeech, QUOTE_STYLES } from "./pipeline/dialogue.js";
export { sentenceSpans, segmentDoc } from "./pipeline/segment.js";
export { attributeSpeakers, Cast } from "./pipeline/speakers.js";
export { assignColors, initials, MARKER_MISC, MARKER_SLOTS, type MarkerSlot } from "./pipeline/palette.js";
export { pronunciationCandidates, type PronunciationCandidate } from "./pipeline/pronunciation.js";

// Import
export { blocksFromHtml } from "./import/html-blocks.js";
export { importEpub } from "./import/epub.js";
export { importPdf, type PdfJsLike } from "./import/pdf.js";
export { splitChapters, type Paragraph } from "./import/chapters.js";
export {
  detectFormat, filterChapters, importBook, UnsupportedFormatError,
  type ChapterFilter, type ImportOptions, type ImportResult, type ImportStage,
} from "./import/index.js";

// Buchformat
export * from "./book/schema.js";
export { createBook, sha256Hex, type SourceInfo } from "./book/create.js";
export { BookFormatError, migrateBook, validateBook } from "./book/migrate.js";
export { bookFromJson, bookToJson, readHbook, writeHbook, type HbookContents } from "./book/hbook.js";
export { bookStats, REVIEW_THRESHOLD, type BookStats } from "./book/stats.js";

// Bearbeiten
export {
  applyBookPatches, applyEdit, describeEdit, EditError, setProgress,
  type Edit, type EditResult, type MarkInput, type Patch, type PronunciationSuggestion, type SpeakerSuggestion,
} from "./edit/edits.js";
export {
  buildLookup, endOf, needsReview, reviewQueue, slotOf, startOf, type BlockRef, type BookLookup,
} from "./edit/lookup.js";
export { rebaseEdits, remapEdit, type JournalEntry, type RebaseResult } from "./edit/rebase.js";

// KI
export * from "./llm/index.js";
