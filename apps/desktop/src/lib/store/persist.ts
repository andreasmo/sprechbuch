/**
 * Automatische Sicherung in IndexedDB.
 *
 * Jedes geöffnete Buch liegt als Schnappschuss im Browser-/WebView-Speicher.
 * Das ist die Absturzsicherung und zugleich die Liste »Zuletzt bearbeitet«.
 * Die .hbook-Datei auf der Platte bleibt das eigentliche Dokument.
 */
import type { Book, HbookChanges, JournalEntry } from "@sprechbuch/core";
import type { FileStamp } from "../platform";

const DB = "sprechbuch";
const VERSION = 1;

export interface Snapshot {
  id: string;
  book: Book;
  /** Pfad (Desktop) bzw. Dateiname (Web) der zuletzt gespeicherten .hbook */
  savedPath: string | null;
  /** Änderungen seit dem letzten Speichern als .hbook */
  dirty: boolean;
  updatedAt: string;
  /** Stempel der .hbook-Fassung, auf der dieser Stand beruht */
  fileStamp?: FileStamp | null;
  /** Eigene Befehle seit dieser Fassung – zum Zusammenführen, wenn die Datei anderswo geändert wurde */
  journal?: JournalEntry[] | null;
  /** Pfad der importierten EPUB/PDF (Desktop) – Vorschlag für den Speicherort */
  sourcePath?: string | null;
  /** Web/iPad: Übergabe-Protokoll – Ausgangsfassung und alle Befehle seitdem, die schon in einer Datei stehen */
  handover?: HbookChanges | null;
}

export interface RecentEntry {
  id: string;
  title: string;
  author?: string;
  savedPath: string | null;
  dirty: boolean;
  updatedAt: string;
  progress: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains("books")) d.createObjectStore("books", { keyPath: "id" });
      if (!d.objectStoreNames.contains("sources")) d.createObjectStore("sources", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then((d) => new Promise<T>((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const saveSnapshot = (s: Snapshot) => tx("books", "readwrite", (st) => st.put(s)).then(() => undefined);
export const loadSnapshot = (id: string) => tx<Snapshot | undefined>("books", "readonly", (st) => st.get(id));
export const saveSource = (id: string, bytes: Uint8Array) => tx("sources", "readwrite", (st) => st.put({ id, bytes })).then(() => undefined);
export const loadSource = (id: string) =>
  tx<{ id: string; bytes: Uint8Array } | undefined>("sources", "readonly", (st) => st.get(id)).then((r) => r?.bytes ?? null);

export async function deleteBook(id: string): Promise<void> {
  await tx("books", "readwrite", (st) => st.delete(id));
  await tx("sources", "readwrite", (st) => st.delete(id));
}

/** Leseposition in Prozent – grob über Absatzposition. */
function progressOf(book: Book): number {
  if (!book.progress) return 0;
  let total = 0;
  let at = 0;
  for (const ch of book.chapters) {
    for (const b of ch.blocks) {
      if (b.id === book.progress.block) at = total;
      total++;
    }
  }
  return total ? Math.round((100 * at) / total) : 0;
}

export async function listRecent(): Promise<RecentEntry[]> {
  const all = await tx<Snapshot[]>("books", "readonly", (st) => st.getAll());
  return all
    .map((s) => ({
      id: s.id, title: s.book.meta.title, ...(s.book.meta.author ? { author: s.book.meta.author } : {}),
      savedPath: s.savedPath, dirty: s.dirty, updatedAt: s.updatedAt, progress: progressOf(s.book),
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
