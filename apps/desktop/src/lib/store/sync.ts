/**
 * Datei auf der Platte ↔ Absturzsicherung in der App: Welche Fassung gilt beim Öffnen?
 * Reine Funktionen, damit die Regeln getestet werden können.
 */
import type { Book, HbookChanges, JournalEntry } from "@sprechbuch/core";
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

export type IncomingDecision =
  /** Kein Übergabe-Protokoll: wie bisher (neuere Datei laden bzw. Konflikt) */
  | { action: "legacy" }
  /** Die andere Fassung beruht genau auf unserem Stand, hier ist nichts offen – einfach übernehmen */
  | { action: "adopt" }
  /** Befehle des anderen Geräts auf unseren Stand übertragen – unser neuerer Stand bleibt erhalten */
  | { action: "apply"; edits: JournalEntry[] }
  /** Protokoll ohne lückenlose Befehle, und die Stände weichen ab – der Mensch entscheidet */
  | { action: "conflict" };

/**
 * Eine Fassung von einem Gerät ohne Dateizugriff (iPad, Browser) trifft ein – beim Öffnen oder weil
 * die Datei im Cloud-Ordner ersetzt wurde. Weil das Gerät nicht prüfen konnte, ob die Datei
 * inzwischen neuer war, darf sie unseren Stand nicht einfach ersetzen.
 */
export function decideIncoming(
  changes: HbookChanges | null | undefined, ownSha: string | undefined, dirty: boolean, fileSha?: string,
): IncomingDecision {
  // Genau diese Datei kennen wir schon (z. B. früher getrennt geöffnet) – nichts Neues
  if (!changes || (fileSha && ownSha === fileSha)) return { action: "legacy" };
  if (!dirty && ownSha && changes.base === ownSha) return { action: "adopt" };
  if (changes.edits) return { action: "apply", edits: changes.edits };
  return { action: "conflict" };
}

/** Gleiche Datei? Windows-Pfade ohne Rücksicht auf Groß-/Kleinschreibung und Trennzeichen */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => (/^[a-zA-Z]:|\\/.test(p) ? p.replace(/\//g, "\\").toLowerCase() : p);
  return norm(a) === norm(b);
}

/** Wie heißt dieses Gerät im Übergabe-Protokoll? */
export function deviceName(nav: { userAgent: string; maxTouchPoints?: number } = navigator): string {
  const ua = nav.userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1)) return "iPad";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/Android/.test(ua)) return "Android-Gerät";
  return "Browser";
}

/** Hat sich die Datei (nach Größe/Zeit) womöglich geändert? Dann lohnt sich das Lesen samt Hash. */
export function mayHaveChanged(known: FileStamp | null, quick: FileStamp): boolean {
  return !known || known.size !== quick.size || known.modifiedMs !== quick.modifiedMs;
}
