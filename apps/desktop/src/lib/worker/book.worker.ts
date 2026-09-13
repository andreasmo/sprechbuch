/**
 * Import und Buchdatei-Verarbeitung im Web Worker – die Oberfläche bleibt auch
 * bei großen Büchern bedienbar.
 */
import {
  BookFormatError, bookStats, importBook, readHbook, UnsupportedFormatError, writeHbook, type PdfJsLike,
} from "@sprechbuch/core";
import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { WorkerRequest, WorkerResponse } from "./protocol";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const post = (msg: WorkerResponse, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer);

self.addEventListener("message", async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  try {
    if (req.type === "import") {
      const t0 = performance.now();
      const { book } = await importBook(req.bytes, req.name, {
        pdfjs: pdfjs as unknown as PdfJsLike,
        pdfjsParams: { verbosity: 0 },
        onProgress: (stage) => post({ id: req.id, type: "progress", stage }),
      });
      const hbook = await writeHbook(book, req.bytes);
      post({ id: req.id, type: "book", book, stats: bookStats(book), hbook, ms: Math.round(performance.now() - t0) }, [hbook.buffer]);
    } else if (req.type === "open") {
      const t0 = performance.now();
      const { book } = await readHbook(req.bytes);
      post({ id: req.id, type: "book", book, stats: bookStats(book), hbook: req.bytes, ms: Math.round(performance.now() - t0) });
    }
  } catch (err) {
    const known = err instanceof BookFormatError || err instanceof UnsupportedFormatError;
    post({ id: req.id, type: "error", message: err instanceof Error ? err.message : String(err), known });
  }
});
