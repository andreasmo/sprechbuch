import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { importBook, importPdf, type PdfJsLike } from "../src/index.js";
import { makePdf, PDF_PAGES as PAGES } from "./helpers.js";

describe("PDF-Import", () => {
  it("rekonstruiert Kapitel, Absätze und Trennungen; entfernt Kopfzeilen und Seitenzahlen", async () => {
    const bytes = await makePdf(PAGES);
    const doc = await importPdf(bytes, "probe.pdf", pdfjs as unknown as PdfJsLike);
    expect(doc.meta).toMatchObject({ title: "Probe-PDF", author: "Test Autorin", source_format: "pdf" });
    const shape = doc.chapters.map((c) => [c.title, c.blocks.map((b) => `${b.type}: ${b.text}`)]);
    expect(shape).toEqual([
      ["Kapitel 1", [
        "h1: Kapitel 1",
        "p: Anna stand lange am Ufer und sah dem kleinen Boot nach, das langsam in der Dämmerung am Horizont verschwand. Der Wind trug den Geruch von Regen herüber.",
        "p: »Kommst du mit?«, fragte Jonas. »Es wird bald dunkel und die Fähre fährt heute nur noch ein einziges Mal.«",
        "p: »Gleich«, antwortete Anna und griff nach der Tasche.",
        "p: Sie nahm die Laterne vom Haken und folgte ihm den schmalen Pfad hinunter zum hölzernen Steg, wo das Wasser leise und gleichmäßig gegen die Pfähle schlug.",
      ]],
      ["Kapitel 2", [
        "h1: Kapitel 2",
        "p: Am nächsten Morgen lag der Fluss still und grau unter einer dichten Decke aus Nebel, der nicht weichen wollte.",
        "p: Niemand im Dorf sprach über das, was in der Nacht am Steg geschehen war, und niemand fragte danach.",
        "p: Ende der Probe.",
      ]],
    ]);
  });

  it("läuft durch die komplette Analyse", async () => {
    const { book } = await importBook(await makePdf(PAGES), "probe.pdf", { pdfjs: pdfjs as unknown as PdfJsLike });
    const speech = book.annotations.filter((a) => a.type === "speech");
    expect(speech.map((a) => a.speaker)).toEqual(["jonas", "jonas", "anna"]);
    expect(book.meta.source.format).toBe("pdf");
  });

  it("verlangt pdf.js für PDF-Dateien", async () => {
    await expect(importBook(await makePdf(PAGES), "probe.pdf")).rejects.toThrow(/pdf\.js/);
  });
});
