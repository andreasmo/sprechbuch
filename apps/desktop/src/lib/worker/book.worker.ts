/**
 * Import, Öffnen und Packen von Buchdateien im Web Worker – die Oberfläche
 * bleibt auch bei großen Büchern bedienbar.
 */
import { bookFromJson, importBook, readHbook, writeHbook, type PdfJsLike } from "@sprechbuch/core";
import type { WorkerRequest, WorkerResponse } from "./protocol";

/** pdf.js erst beim ersten Import laden – die Lese-App braucht es nie */
async function loadPdfjs(): Promise<PdfJsLike> {
  const [pdfjs, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs as unknown as PdfJsLike;
}

const post = (msg: WorkerResponse, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer);

self.addEventListener("message", async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  try {
    switch (req.type) {
      case "import": {
        const { book } = await importBook(req.bytes, req.name, {
          // PDF am Dateianfang „%PDF“ erkennen, nicht am Namen
          ...(req.bytes[0] === 0x25 && req.bytes[1] === 0x50 ? { pdfjs: await loadPdfjs() } : {}),
          pdfjsParams: { verbosity: 0 },
          onProgress: (stage) => post({ id: req.id, type: "progress", stage }),
        });
        post({ id: req.id, type: "book", book, source: req.bytes, ms: ms() });
        break;
      }
      case "open": {
        const { book, source, changes } = await readHbook(req.bytes);
        post({ id: req.id, type: "book", book, source: source?.bytes ?? null, changes: changes ?? null, ms: ms() });
        break;
      }
      case "json": {
        post({ id: req.id, type: "book", book: bookFromJson(req.text), source: null, ms: ms() });
        break;
      }
      case "pack": {
        const bytes = await writeHbook(req.book, req.source, req.changes);
        post({ id: req.id, type: "bytes", bytes }, [bytes.buffer]);
        break;
      }
    }
  } catch (err) {
    post({ id: req.id, type: "error", message: err instanceof Error ? err.message : String(err) });
  }
});
