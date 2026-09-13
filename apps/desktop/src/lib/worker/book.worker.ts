/**
 * Import, Öffnen und Packen von Buchdateien im Web Worker – die Oberfläche
 * bleibt auch bei großen Büchern bedienbar.
 */
import { bookFromJson, importBook, readHbook, writeHbook, type PdfJsLike } from "@sprechbuch/core";
import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { WorkerRequest, WorkerResponse } from "./protocol";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

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
          pdfjs: pdfjs as unknown as PdfJsLike,
          pdfjsParams: { verbosity: 0 },
          onProgress: (stage) => post({ id: req.id, type: "progress", stage }),
        });
        post({ id: req.id, type: "book", book, source: req.bytes, ms: ms() });
        break;
      }
      case "open": {
        const { book, source } = await readHbook(req.bytes);
        post({ id: req.id, type: "book", book, source: source?.bytes ?? null, ms: ms() });
        break;
      }
      case "json": {
        post({ id: req.id, type: "book", book: bookFromJson(req.text), source: null, ms: ms() });
        break;
      }
      case "pack": {
        const bytes = await writeHbook(req.book, req.source);
        post({ id: req.id, type: "bytes", bytes }, [bytes.buffer]);
        break;
      }
    }
  } catch (err) {
    post({ id: req.id, type: "error", message: err instanceof Error ? err.message : String(err) });
  }
});
