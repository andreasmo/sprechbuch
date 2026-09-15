import type { Book, HbookChanges, ImportStage } from "@sprechbuch/core";

export type WorkerRequest =
  | { id: number; type: "import"; name: string; bytes: Uint8Array }
  | { id: number; type: "open"; bytes: Uint8Array }
  | { id: number; type: "json"; text: string }
  | { id: number; type: "pack"; book: Book; source: Uint8Array | null; changes: HbookChanges | null };

export type WorkerResponse =
  | { id: number; type: "progress"; stage: ImportStage }
  | { id: number; type: "book"; book: Book; source: Uint8Array | null; changes?: HbookChanges | null; ms: number }
  | { id: number; type: "bytes"; bytes: Uint8Array }
  | { id: number; type: "error"; message: string };

export interface LoadedBook {
  book: Book;
  source: Uint8Array | null;
  /** Übergabe-Protokoll eines anderen Geräts (nur bei .hbook) */
  changes: HbookChanges | null;
  ms: number;
}

type Payload = WorkerRequest extends infer R ? (R extends WorkerRequest ? Omit<R, "id"> : never) : never;

let worker: Worker | null = null;
let nextId = 1;

function getWorker(): Worker {
  worker ??= new Worker(new URL("./book.worker.ts", import.meta.url), { type: "module" });
  return worker;
}

function run<R>(req: Payload, pick: (msg: WorkerResponse) => R | undefined, onProgress?: (s: ImportStage) => void): Promise<R> {
  const id = nextId++;
  const w = getWorker();
  return new Promise((resolve, reject) => {
    const onMessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data;
      if (msg.id !== id) return;
      if (msg.type === "progress") {
        onProgress?.(msg.stage);
        return;
      }
      w.removeEventListener("message", onMessage);
      if (msg.type === "error") reject(new Error(msg.message));
      else {
        const r = pick(msg);
        if (r === undefined) reject(new Error(`Unerwartete Antwort: ${msg.type}`));
        else resolve(r);
      }
    };
    w.addEventListener("message", onMessage);
    w.postMessage({ ...req, id });
  });
}

const asBook = (m: WorkerResponse) => (m.type === "book" ? { book: m.book, source: m.source, changes: m.changes ?? null, ms: m.ms } : undefined);

export const importSource = (name: string, bytes: Uint8Array, onProgress?: (s: ImportStage) => void) =>
  run<LoadedBook>({ type: "import", name, bytes }, asBook, onProgress);

export const openHbook = (bytes: Uint8Array) => run<LoadedBook>({ type: "open", bytes }, asBook);

export const openJson = (text: string) => run<LoadedBook>({ type: "json", text }, asBook);

/** Buch (+ Quelle, + Übergabe-Protokoll) zu .hbook-Bytes packen – im Worker, weil ZIP-Kompression Zeit kostet. */
export const packHbook = (book: Book, source: Uint8Array | null, changes: HbookChanges | null = null) =>
  run<Uint8Array>({ type: "pack", book, source, changes }, (m) => (m.type === "bytes" ? m.bytes : undefined));
