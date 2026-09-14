/**
 * Eigene Änderungen auf eine andere Fassung desselben Buches übertragen.
 *
 * Typischer Fall: Die `.hbook`-Datei liegt in einem Cloud-Ordner und wurde auf einem
 * anderen Gerät weiterbearbeitet, während hier ungespeicherte Änderungen offen sind.
 * Weil jede Änderung ein serialisierbarer Befehl ist, werden die eigenen Befehle seit dem
 * letzten gemeinsamen Stand einfach auf der neuen Fassung wiederholt. Der Text selbst ist
 * unveränderlich, Offsets bleiben also gültig.
 *
 * Regeln:
 * - Bei gleichen Stellen gewinnt die eigene Änderung (sie ist die jüngere Entscheidung).
 * - Was es in der anderen Fassung nicht mehr gibt, wird übersprungen und gemeldet.
 * - Schon Erledigtes (Markierung dort bereits entfernt, gleiche Markierung schon gesetzt)
 *   gilt als erledigt, nicht als Fehler.
 * - Neu angelegte IDs können sich unterscheiden; spätere Befehle werden umgeschrieben.
 */
import type { Book } from "../book/schema.js";
import { applyEdit, describeEdit, EditError, type Edit, type EditResult, type MarkInput } from "./edits.js";

export interface JournalEntry {
  edit: Edit;
  /** ID, die der Befehl beim ersten Anwenden angelegt hat */
  created?: string;
}

export interface RebaseResult {
  book: Book;
  /** Tatsächlich angewendete Befehle (umgeschrieben) mit Patches – für die neue Rückgängig-Historie */
  applied: { edit: Edit; result: EditResult }[];
  /** Befehle ohne Wirkung, weil die andere Fassung schon so ist */
  unchanged: Edit[];
  /** Befehle, die auf der anderen Fassung nicht mehr passen */
  skipped: { edit: Edit; label: string; reason: string }[];
}

type IdMap = Map<string, string>;
const re = (map: IdMap, id: string) => map.get(id) ?? id;
const reN = (map: IdMap, id: string | null) => (id === null ? null : re(map, id));

/** IDs in einem Befehl auf die neue Fassung umschreiben. */
export function remapEdit(edit: Edit, ann: IdMap, cast: IdMap): Edit {
  switch (edit.type) {
    case "setSpeaker": return { ...edit, ids: edit.ids.map((i) => re(ann, i)), speaker: reN(cast, edit.speaker) };
    case "confirmSpeech": return { ...edit, ids: edit.ids.map((i) => re(ann, i)) };
    case "addSpeech": return { ...edit, speaker: reN(cast, edit.speaker) };
    case "splitSpeech": return { ...edit, id: re(ann, edit.id), speaker: reN(cast, edit.speaker) };
    case "removeAnnotation": return { ...edit, id: re(ann, edit.id) };
    case "setNote": return { ...edit, id: re(ann, edit.id) };
    case "updateCast": return { ...edit, id: re(cast, edit.id) };
    case "setCastColor": return { ...edit, id: re(cast, edit.id) };
    case "mergeCast": return { ...edit, from: re(cast, edit.from), into: re(cast, edit.into) };
    default: return edit;
  }
}

/** Gibt es genau diese Markierung schon? Dann ist ihr Setzen erledigt. */
function existingMark(book: Book, m: MarkInput): string | undefined {
  return book.annotations.find((a) => {
    if (a.type !== m.type || a.block !== m.block) return false;
    if ("at" in m) return "at" in a && a.at === m.at;
    return "start" in a && a.start === m.start && a.end === m.end;
  })?.id;
}

const createsAnnotation = (e: Edit) => e.type === "addSpeech" || e.type === "splitSpeech" || e.type === "addMark";

export function rebaseEdits(base: Book, journal: readonly JournalEntry[], now: Date = new Date()): RebaseResult {
  let book = base;
  const ann: IdMap = new Map();
  const cast: IdMap = new Map();
  const applied: RebaseResult["applied"] = [];
  const unchanged: Edit[] = [];
  const skipped: RebaseResult["skipped"] = [];

  for (const entry of journal) {
    const edit = remapEdit(entry.edit, ann, cast);

    if (edit.type === "addMark") {
      const same = existingMark(book, edit.mark);
      if (same) {
        if (entry.created) ann.set(entry.created, same);
        unchanged.push(edit);
        continue;
      }
    }
    if (edit.type === "removeAnnotation" && !book.annotations.some((a) => a.id === edit.id)) {
      unchanged.push(edit);
      continue;
    }

    try {
      const result = applyEdit(book, edit, now);
      if (entry.created && result.created && entry.created !== result.created) {
        (createsAnnotation(edit) ? ann : cast).set(entry.created, result.created);
      }
      if (!result.patches.length) {
        unchanged.push(edit);
        continue;
      }
      book = result.book;
      applied.push({ edit, result });
    } catch (err) {
      if (!(err instanceof EditError)) throw err;
      skipped.push({ edit, label: describeEdit(edit), reason: err.message });
    }
  }
  return { book, applied, unchanged, skipped };
}
