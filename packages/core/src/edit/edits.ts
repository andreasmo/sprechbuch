/**
 * Bearbeitungsbefehle für ein Buch.
 *
 * Jede Änderung ist ein serialisierbares Objekt (`Edit`) und wird mit
 * `applyEdit` angewendet. Das Ergebnis enthält neben dem neuen Buch die
 * Immer-Patches und Gegen-Patches – damit sind Rückgängig/Wiederholen und ein
 * Änderungsjournal ohne eigene Umkehrlogik möglich.
 *
 * Alle Änderungen durch den Menschen bekommen `origin: "user"` und werden von
 * keiner automatischen Analyse mehr überschrieben.
 */
import { applyPatches, enablePatches, produce, produceWithPatches, type Draft, type Patch } from "immer";
import type { Annotation, Book, BookBlock, CastEntry, SpeechAnnotation } from "../book/schema.js";
import { MARKER_SLOTS, initials } from "../pipeline/palette.js";
import { slug } from "../text.js";
import { endOf, startOf } from "./lookup.js";

enablePatches();

type RangedMarkType = "emphasis" | "retake" | "bookmark" | "note";
type PointMarkType = "pause" | "breath";

export type MarkInput =
  | { type: Exclude<RangedMarkType, "note">; block: string; start: number; end: number; note?: string }
  | { type: "note"; block: string; start: number; end: number; text: string }
  | { type: "pause"; block: string; at: number; length: "short" | "long" }
  | { type: "breath"; block: string; at: number };

export type Edit =
  | { type: "setSpeaker"; ids: string[]; speaker: string | null }
  | { type: "confirmSpeech"; ids: string[] }
  | { type: "addSpeech"; block: string; start: number; end: number; speaker: string | null }
  | { type: "splitSpeech"; id: string; at: number; speaker: string | null }
  | { type: "removeAnnotation"; id: string }
  | { type: "addMark"; mark: MarkInput }
  | { type: "setNote"; id: string; text: string }
  | { type: "mergeSentences"; block: string; index: number }
  | { type: "splitSentence"; block: string; at: number }
  | { type: "addCast"; name: string }
  | { type: "updateCast"; id: string; name?: string; voiceNote?: string; gender?: CastEntry["gender"]; badge?: string; aliases?: string[] }
  | { type: "setCastColor"; id: string; color: number | null }
  | { type: "mergeCast"; from: string; into: string }
  | { type: "updatePronunciation"; term: string; hint?: string; ipa?: string; verified?: boolean };

export interface EditResult {
  book: Book;
  patches: Patch[];
  inverse: Patch[];
  /** ID eines neu angelegten Objekts (Markierung, Figur). */
  created?: string;
}

export class EditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditError";
  }
}

const LABELS: Record<Edit["type"], string> = {
  setSpeaker: "Sprecher geändert",
  confirmSpeech: "Zuordnung bestätigt",
  addSpeech: "Rede markiert",
  splitSpeech: "Rede geteilt",
  removeAnnotation: "Markierung entfernt",
  addMark: "Markierung gesetzt",
  setNote: "Notiz geändert",
  mergeSentences: "Sätze verbunden",
  splitSentence: "Satz geteilt",
  addCast: "Figur angelegt",
  updateCast: "Figur geändert",
  setCastColor: "Farbe geändert",
  mergeCast: "Figuren zusammengeführt",
  updatePronunciation: "Aussprache geändert",
};

const MARK_LABELS: Record<MarkInput["type"], string> = {
  emphasis: "Betonung gesetzt", retake: "Retake markiert", bookmark: "Lesezeichen gesetzt",
  note: "Notiz hinzugefügt", pause: "Pause gesetzt", breath: "Atemzeichen gesetzt",
};

export function describeEdit(edit: Edit): string {
  if (edit.type === "addMark") return MARK_LABELS[edit.mark.type];
  if (edit.type === "setSpeaker" && edit.speaker === null) return "Sprecher entfernt";
  return LABELS[edit.type];
}

// --------------------------------------------------------------------------- //
// Hilfen
// --------------------------------------------------------------------------- //
const isSpace = (ch: string | undefined) => ch !== undefined && /\s/u.test(ch);

function findBlock(book: Book | Draft<Book>, id: string): { chapterId: string; block: Draft<BookBlock> } {
  for (const ch of book.chapters) {
    for (const b of ch.blocks) if (b.id === id) return { chapterId: ch.id, block: b as Draft<BookBlock> };
  }
  throw new EditError(`Unbekannter Absatz: ${id}`);
}

function findAnnotation(book: Draft<Book>, id: string): Draft<Annotation> {
  const a = book.annotations.find((x) => x.id === id);
  if (!a) throw new EditError(`Unbekannte Markierung: ${id}`);
  return a;
}

function findSpeech(book: Draft<Book>, id: string): Draft<SpeechAnnotation> {
  const a = findAnnotation(book, id);
  if (a.type !== "speech") throw new EditError(`Markierung ${id} ist keine Rede.`);
  return a;
}

function requireCast(book: Draft<Book>, id: string | null): void {
  if (id !== null && !book.cast.some((c) => c.id === id)) throw new EditError(`Unbekannte Figur: ${id}`);
}

function nextAnnotationId(book: Draft<Book>): string {
  let max = 0;
  for (const a of book.annotations) {
    const m = /^a(\d+)$/.exec(a.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `a${String(max + 1).padStart(6, "0")}`;
}

/** Bereich an Leerraum-Rändern einkürzen. */
function trimRange(text: string, start: number, end: number): [number, number] {
  let s = Math.max(0, start);
  let e = Math.min(text.length, end);
  while (s < e && isSpace(text[s])) s++;
  while (e > s && isSpace(text[e - 1])) e--;
  return [s, e];
}

function checkRange(block: BookBlock, start: number, end: number, what: string): [number, number] {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > block.text.length || start >= end) {
    throw new EditError(`${what}: ungültiger Bereich ${start}–${end}.`);
  }
  const [s, e] = trimRange(block.text, start, end);
  if (s >= e) throw new EditError(`${what}: der Bereich enthält nur Leerraum.`);
  return [s, e];
}

/**
 * Kapitelweise Farben neu ordnen: Figuren ohne feste Farbe bekommen in jedem
 * Kapitel, in dem sie sprechen, einen dort freien Slot. Bestehende Zuordnungen
 * bleiben erhalten, solange sie nicht mit einer festen Farbe kollidieren.
 */
function normalizeChapterColors(book: Draft<Book>): void {
  const global = new Map(book.cast.map((c) => [c.id, c.color]));
  const blockChapter = new Map<string, string>();
  for (const ch of book.chapters) for (const b of ch.blocks) blockChapter.set(b.id, ch.id);

  const present = new Map<string, string[]>();
  for (const a of book.annotations) {
    if (a.type !== "speech" || !a.speaker || !global.has(a.speaker)) continue;
    const ch = blockChapter.get(a.block)!;
    const list = present.get(ch) ?? [];
    if (!list.includes(a.speaker)) list.push(a.speaker);
    present.set(ch, list);
  }

  const next: Record<string, Record<string, number | null>> = {};
  for (const ch of book.chapters) {
    const speakers = present.get(ch.id) ?? [];
    const taken = new Set<number>();
    for (const s of speakers) {
      const g = global.get(s);
      if (g !== null && g !== undefined) taken.add(g);
    }
    const old = book.chapterColors[ch.id] ?? {};
    const local: Record<string, number | null> = {};
    const pending: string[] = [];
    for (const s of speakers) {
      if (global.get(s) !== null) continue;
      const keep = old[s];
      if (keep !== null && keep !== undefined && !taken.has(keep)) {
        local[s] = keep;
        taken.add(keep);
      } else {
        pending.push(s);
      }
    }
    for (const s of pending) {
      const free = MARKER_SLOTS.findIndex((_, i) => !taken.has(i));
      local[s] = free >= 0 ? free : null;
      if (free >= 0) taken.add(free);
    }
    if (Object.keys(local).length) next[ch.id] = local;
  }
  // Nur schreiben, was sich tatsächlich ändert – hält die Patches klein
  for (const id of Object.keys(book.chapterColors)) if (!next[id]) delete book.chapterColors[id];
  for (const [id, local] of Object.entries(next)) {
    if (JSON.stringify(book.chapterColors[id]) !== JSON.stringify(local)) book.chapterColors[id] = local;
  }
}

function uniqueCastId(book: Draft<Book>, name: string): string {
  const base = slug(name);
  let id = base;
  for (let n = 2; book.cast.some((c) => c.id === id); n++) id = `${base}-${n}`;
  return id;
}

// --------------------------------------------------------------------------- //
// Anwenden
// --------------------------------------------------------------------------- //
function run(book: Draft<Book>, edit: Edit): string | undefined {
  switch (edit.type) {
    case "setSpeaker": {
      requireCast(book, edit.speaker);
      for (const id of edit.ids) {
        const a = findSpeech(book, id);
        a.speaker = edit.speaker;
        a.origin = "user";
        a.confidence = 1;
      }
      normalizeChapterColors(book);
      return;
    }
    case "confirmSpeech": {
      for (const id of edit.ids) {
        const a = findSpeech(book, id);
        a.origin = "user";
        a.confidence = 1;
      }
      return;
    }
    case "addSpeech": {
      requireCast(book, edit.speaker);
      const { block } = findBlock(book, edit.block);
      const [start, end] = checkRange(block, edit.start, edit.end, "Rede");
      // Überlappende Rede ersetzen – die ausdrückliche Markierung gewinnt
      book.annotations = book.annotations.filter((a) =>
        !(a.type === "speech" && a.block === edit.block && a.start < end && a.end > start));
      const id = nextAnnotationId(book);
      book.annotations.push({
        type: "speech", id, block: edit.block, start, end, speaker: edit.speaker, origin: "user", confidence: 1, via: null,
      });
      normalizeChapterColors(book);
      return id;
    }
    case "splitSpeech": {
      requireCast(book, edit.speaker);
      const a = findSpeech(book, edit.id);
      const { block } = findBlock(book, a.block);
      const [, leftEnd] = trimRange(block.text, a.start, edit.at);
      const [rightStart] = trimRange(block.text, edit.at, a.end);
      if (leftEnd <= a.start || rightStart >= a.end) throw new EditError("Rede kann hier nicht geteilt werden.");
      const oldEnd = a.end;
      a.end = leftEnd;
      const id = nextAnnotationId(book);
      book.annotations.push({
        type: "speech", id, block: a.block, start: rightStart, end: oldEnd, speaker: edit.speaker,
        origin: "user", confidence: 1, via: null,
      });
      normalizeChapterColors(book);
      return id;
    }
    case "removeAnnotation": {
      const a = findAnnotation(book, edit.id);
      book.annotations.splice(book.annotations.indexOf(a), 1);
      if (a.type === "speech") normalizeChapterColors(book);
      return;
    }
    case "addMark": {
      const m = edit.mark;
      const { block } = findBlock(book, m.block);
      const id = nextAnnotationId(book);
      if (m.type === "pause" || m.type === "breath") {
        if (!Number.isInteger(m.at) || m.at < 0 || m.at > block.text.length) throw new EditError("Ungültige Position.");
        book.annotations.push(m.type === "pause"
          ? { type: "pause", id, block: m.block, at: m.at, length: m.length, origin: "user" }
          : { type: "breath", id, block: m.block, at: m.at, origin: "user" });
      } else {
        const [start, end] = checkRange(block, m.start, m.end, "Markierung");
        if (m.type === "note") {
          book.annotations.push({ type: "note", id, block: m.block, start, end, text: m.text, origin: "user" });
        } else if (m.type === "retake") {
          book.annotations.push({ type: "retake", id, block: m.block, start, end, origin: "user", ...(m.note ? { note: m.note } : {}) });
        } else {
          book.annotations.push({ type: m.type, id, block: m.block, start, end, origin: "user" });
        }
      }
      return id;
    }
    case "setNote": {
      const a = findAnnotation(book, edit.id);
      if (a.type === "note") a.text = edit.text;
      else if (a.type === "retake") a.note = edit.text;
      else throw new EditError("Nur Notizen und Retakes haben einen Text.");
      return;
    }
    case "mergeSentences": {
      const { block } = findBlock(book, edit.block);
      const cur = block.sentences[edit.index];
      const next = block.sentences[edit.index + 1];
      if (!cur || !next) throw new EditError("Hier gibt es keine Satzgrenze zum Entfernen.");
      cur[1] = next[1];
      block.sentences.splice(edit.index + 1, 1);
      clampProgress(book, edit.block, block.sentences.length);
      return;
    }
    case "splitSentence": {
      const { block } = findBlock(book, edit.block);
      const i = block.sentences.findIndex(([s, e]) => s < edit.at && edit.at < e);
      if (i < 0) throw new EditError("Keine Satzgrenze an dieser Stelle möglich.");
      const [s, e] = block.sentences[i]!;
      const [, leftEnd] = trimRange(block.text, s, edit.at);
      const [rightStart] = trimRange(block.text, edit.at, e);
      if (leftEnd <= s || rightStart >= e) throw new EditError("Keine Satzgrenze an dieser Stelle möglich.");
      block.sentences.splice(i, 1, [s, leftEnd], [rightStart, e]);
      return;
    }
    case "addCast": {
      const name = edit.name.trim().replace(/\s+/g, " ");
      if (!name) throw new EditError("Die Figur braucht einen Namen.");
      const key = name.toLowerCase();
      const existing = book.cast.find((c) => c.name.toLowerCase() === key || c.aliases.some((x) => x.toLowerCase() === key));
      if (existing) return existing.id;
      const id = uniqueCastId(book, name);
      book.cast.push({
        id, name, aliases: [], gender: "?", color: null, badge: initials(name), voiceNote: "", kind: "name", origin: "user",
      });
      return id;
    }
    case "updateCast": {
      const c = book.cast.find((x) => x.id === edit.id);
      if (!c) throw new EditError(`Unbekannte Figur: ${edit.id}`);
      if (edit.name !== undefined) {
        const name = edit.name.trim().replace(/\s+/g, " ");
        if (!name) throw new EditError("Die Figur braucht einen Namen.");
        if (c.badge === initials(c.name) && edit.badge === undefined) c.badge = initials(name);
        c.name = name;
      }
      if (edit.voiceNote !== undefined) c.voiceNote = edit.voiceNote;
      if (edit.gender !== undefined) c.gender = edit.gender;
      if (edit.badge !== undefined) c.badge = edit.badge.trim().slice(0, 3) || initials(c.name);
      if (edit.aliases !== undefined) c.aliases = [...new Set(edit.aliases.map((x) => x.trim()).filter(Boolean))];
      c.origin = "user";
      return;
    }
    case "setCastColor": {
      const c = book.cast.find((x) => x.id === edit.id);
      if (!c) throw new EditError(`Unbekannte Figur: ${edit.id}`);
      if (edit.color !== null && (!Number.isInteger(edit.color) || edit.color < 0 || edit.color >= MARKER_SLOTS.length)) {
        throw new EditError("Ungültige Farbe.");
      }
      // Farbe schon vergeben? Dann tauschen die beiden Figuren
      const holder = edit.color === null ? undefined : book.cast.find((x) => x.id !== c.id && x.color === edit.color);
      if (holder) holder.color = c.color;
      c.color = edit.color;
      c.origin = "user";
      normalizeChapterColors(book);
      return;
    }
    case "mergeCast": {
      if (edit.from === edit.into) throw new EditError("Eine Figur kann nicht mit sich selbst zusammengeführt werden.");
      const from = book.cast.find((x) => x.id === edit.from);
      const into = book.cast.find((x) => x.id === edit.into);
      if (!from || !into) throw new EditError("Unbekannte Figur.");
      for (const a of book.annotations) if (a.type === "speech" && a.speaker === from.id) a.speaker = into.id;
      const aliases = new Set([...into.aliases, from.name, ...from.aliases]);
      aliases.delete(into.name);
      into.aliases = [...aliases];
      if (into.color === null && from.color !== null) into.color = from.color;
      if (!into.voiceNote && from.voiceNote) into.voiceNote = from.voiceNote;
      into.origin = "user";
      book.cast.splice(book.cast.indexOf(from), 1);
      normalizeChapterColors(book);
      return;
    }
    case "updatePronunciation": {
      const p = book.pronunciations.find((x) => x.term === edit.term);
      if (!p) throw new EditError(`Unbekannter Eintrag: ${edit.term}`);
      if (edit.hint !== undefined) p.hint = edit.hint;
      if (edit.ipa !== undefined) p.ipa = edit.ipa;
      if (edit.verified !== undefined) p.verified = edit.verified;
      p.origin = "user";
      return;
    }
  }
}

function clampProgress(book: Draft<Book>, blockId: string, sentences: number): void {
  if (book.progress?.block === blockId && book.progress.sentence >= sentences) {
    book.progress.sentence = Math.max(0, sentences - 1);
  }
}

export function applyEdit(book: Book, edit: Edit, now: Date = new Date()): EditResult {
  let created: string | undefined;
  const [next, patches, inverse] = produceWithPatches(book, (draft) => {
    created = run(draft, edit);
  });
  const extra = created ? { created } : {};
  // Nichts geändert (z. B. Figur existiert schon) → kein Rückgängig-Schritt, kein neuer Zeitstempel
  if (!patches.length) return { book, patches, inverse, ...extra };
  const [stamped, p2, i2] = produceWithPatches(next, (draft) => {
    draft.meta.modifiedAt = now.toISOString();
  });
  return { book: stamped, patches: [...patches, ...p2], inverse: [...i2, ...inverse], ...extra };
}

/** Patches anwenden – für Rückgängig (Gegen-Patches) und Wiederholen. */
export function applyBookPatches(book: Book, patches: Patch[]): Book {
  return applyPatches(book, patches);
}

/** Leseposition setzen – bewusst ohne Patches, gehört nicht in die Rückgängig-Historie. */
export function setProgress(book: Book, block: string, sentence: number): Book {
  if (book.progress?.block === block && book.progress.sentence === sentence) return book;
  return produce(book, (draft) => {
    draft.progress = { block, sentence };
  });
}

export { endOf, startOf };
export type { Patch };
