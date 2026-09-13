import type { Book, BookStats, ImportStage } from "@sprechbuch/core";

export type WorkerRequest =
  | { id: number; type: "import"; name: string; bytes: Uint8Array }
  | { id: number; type: "open"; name: string; bytes: Uint8Array };

export type WorkerResponse =
  | { id: number; type: "progress"; stage: ImportStage }
  | { id: number; type: "book"; book: Book; stats: BookStats; hbook: Uint8Array; ms: number }
  | { id: number; type: "error"; message: string; known: boolean };

export interface LoadedBook {
  book: Book;
  stats: BookStats;
  hbook: Uint8Array;
  ms: number;
}

let worker: Worker | null = null;
let nextId = 1;

function getWorker(): Worker {
  worker ??= new Worker(new URL("./book.worker.ts", import.meta.url), { type: "module" });
  return worker;
}

function run(req: Omit<WorkerRequest, "id">, onProgress?: (s: ImportStage) => void): Promise<LoadedBook> {
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
      else resolve({ book: msg.book, stats: msg.stats, hbook: msg.hbook, ms: msg.ms });
    };
    w.addEventListener("message", onMessage);
    w.postMessage({ ...req, id });
  });
}

export const importSource = (name: string, bytes: Uint8Array, onProgress?: (s: ImportStage) => void) =>
  run({ type: "import", name, bytes }, onProgress);

export const openHbook = (name: string, bytes: Uint8Array) => run({ type: "open", name, bytes });
