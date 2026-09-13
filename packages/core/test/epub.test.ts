import { describe, expect, it } from "vitest";
import { blocksFromHtml, importEpub } from "../src/index.js";
import { makeEpub } from "./helpers.js";

describe("HTML-Blöcke", () => {
  it("fasst Leerraum zusammen und hält Kursiv-Offsets exakt", () => {
    const [b] = blocksFromHtml("<p>  Er   sagte\n <em>ganz\tleise</em>&nbsp;:  »Nein«  </p>");
    expect(b!.text).toBe("Er sagte ganz leise : »Nein«");
    expect(b!.marks).toEqual([{ s: 9, e: 19, k: "em" }]);
    expect(b!.text.slice(9, 19)).toBe("ganz leise");
  });

  it("dekodiert Entities, überspringt head/script/table und erkennt Blocktypen", () => {
    const blocks = blocksFromHtml(`<html><head><title>T</title></head><body>
      <h1>Kapitel&#160;1</h1><h3>Unter&shy;titel</h3>
      <script>var x = "<p>nicht</p>";</script>
      <p>&#8222;Hallo&#8220;, rief sie.<br/>Zweite Zeile</p>
      <table><tr><td>weg</td></tr></table>
      <blockquote>Zitat</blockquote></body></html>`);
    expect(blocks.map((b) => [b.type, b.text])).toEqual([
      ["h1", "Kapitel 1"],
      ["h2", "Unter­titel"],
      ["p", "„Hallo“, rief sie. Zweite Zeile"],
      ["quote", "Zitat"],
    ]);
  });
});

describe("EPUB-Import", () => {
  it("liest Spine-Reihenfolge, Metadaten und Kapiteltitel, überspringt nav", async () => {
    const bytes = await makeEpub(
      [
        { file: "k1.xhtml", body: "<h1>I</h1><h2>Der Fluss</h2><p>Erster Absatz.</p>" },
        { file: "k2.xhtml", body: "<p>Kein Titel im Text.</p>" },
      ],
      { title: "Probebuch", author: "A. Autorin" },
    );
    const doc = await importEpub(bytes, "probe.epub");
    expect(doc.meta).toMatchObject({ title: "Probebuch", author: "A. Autorin", language: "de", source_format: "epub" });
    // Spine-Position 1 ist nav → Kapitel-IDs zählen die Spine-Position mit (wie die Referenz)
    expect(doc.chapters.map((c) => [c.id, c.title])).toEqual([
      ["ch002", "I – Der Fluss"],
      ["ch003", "Inhalt 2"],
    ]);
  });

  it("meldet kaputte Dateien verständlich", async () => {
    await expect(importEpub(new Uint8Array([1, 2, 3]))).rejects.toThrow();
  });
});
