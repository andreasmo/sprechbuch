/** Nur für Tests: kleines Buch aus HTML-Kapiteln über den echten Import. */
import { importBook, type Book } from "@sprechbuch/core";
import JSZip from "jszip";

export async function bookFrom(...chapters: string[]): Promise<Book> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file("META-INF/container.xml", `<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="c.opf"/></rootfiles></container>`);
  const items = chapters.map((_, i) => `<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`).join("");
  const spine = chapters.map((_, i) => `<itemref idref="c${i}"/>`).join("");
  zip.file("c.opf", `<package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>T</dc:title></metadata><manifest>${items}</manifest><spine>${spine}</spine></package>`);
  chapters.forEach((body, i) => zip.file(`c${i}.xhtml`, `<html><body>${body}</body></html>`));
  return (await importBook(await zip.generateAsync({ type: "uint8array" }), "t.epub")).book;
}
