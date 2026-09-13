import { importBook } from "@sprechbuch/core";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { renderBlock, stripFinalPeriod } from "./render";

async function epub(body: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file("META-INF/container.xml", `<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="c.opf"/></rootfiles></container>`);
  zip.file("c.opf", `<package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>T</dc:title></metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/></spine></package>`);
  zip.file("a.xhtml", `<html><body>${body}</body></html>`);
  return zip.generateAsync({ type: "uint8array" });
}

describe("stripFinalPeriod", () => {
  it("entfernt den Schlusspunkt, auch vor schließendem Anführungszeichen", () => {
    expect(stripFinalPeriod("Er ging.")).toBe("Er ging");
    expect(stripFinalPeriod("»…und die Lenden.«")).toBe("»…und die Lenden«");
    expect(stripFinalPeriod("Wirklich?")).toBe("Wirklich?");
    expect(stripFinalPeriod("Kein Punkt")).toBe("Kein Punkt");
  });
});

describe("renderBlock", () => {
  it("zerlegt Rede, Erzähltext und Satzgrenzen; Kürzel am Anfang jeder Redepassage", async () => {
    const { book } = await importBook(await epub(
      "<p>»Kommst du mit?«, fragte Anna. »Es wird bald dunkel.« Jonas nickte.</p>",
    ), "t.epub");
    const block = book.chapters[0]!.blocks[0]!;
    const cast = new Map(book.cast.map((c) => [c.id, c]));
    const pieces = renderBlock(book, book.chapters[0]!.id, block, book.annotations.filter((a) => a.block === block.id), cast);
    expect(pieces.map((p) => (p.kind === "pipe" ? "|" : p.speaker ? `[${p.badge ?? ""}:${p.text}]` : p.text))).toEqual([
      "[An:»Kommst du mit?«]", ", fragte Anna", "|", " ",
      "[An:»Es wird bald dunkel«]", "|", " ",
      "Jonas nickte", "|",
    ]);
    expect(pieces.filter((p) => p.speaker).every((p) => p.speaker === "anna" && p.slot !== undefined)).toBe(true);
  });
});
