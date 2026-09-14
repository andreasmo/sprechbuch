/**
 * Datei auf der Platte ↔ Absturzsicherung in der App: Welche Fassung gilt beim Öffnen?
 * Reine Funktionen, damit die Regeln getestet werden können.
 */
import type { Book, JournalEntry } from "@sprechbuch/core";
import type { FileStamp } from "../platform";

export interface SnapshotBase {
  book: Book;
  dirty: boolean;
  /** Stempel der Datei, auf der der Schnappschuss beruht */
  fileStamp?: FileStamp | null;
  /** eigene Befehle seit dieser Fassung; null = nicht linear (z. B. über den Speicherstand hinaus rückgängig gemacht) */
  journal?: JournalEntry[] | null;
}

export type OpenDecision =
  /** Schnappschuss nutzen: beruht auf genau dieser Datei (ggf. mit ungespeicherten Änderungen) */
  | { action: "resume" }
  /** Datei laden: kein Schnappschuss, oder er enthält nichts, was nicht in einer Datei stünde */
  | { action: "file" }
  /** Beide Seiten haben eigene Änderungen */
  | { action: "conflict"; canMerge: boolean };

export function decideOpen(snapshot: SnapshotBase | undefined, fileSha: string | undefined): OpenDecision {
  if (!snapshot) return { action: "file" };
  if (fileSha && snapshot.fileStamp?.sha256 === fileSha) return { action: "resume" };
  if (!snapshot.dirty) return { action: "file" };
  return { action: "conflict", canMerge: Array.isArray(snapshot.journal) };
}

/** Hat sich die Datei (nach Größe/Zeit) womöglich geändert? Dann lohnt sich das Lesen samt Hash. */
export function mayHaveChanged(known: FileStamp | null, quick: FileStamp): boolean {
  return !known || known.size !== quick.size || known.modifiedMs !== quick.modifiedMs;
}
