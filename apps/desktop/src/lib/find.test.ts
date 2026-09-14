import { applyEdit, buildLookup, type Book } from "@sprechbuch/core";
import { describe, expect, it } from "vitest";
import { findHits, findSpeechSentence, hitContext } from "./find";
import { listMarks, marksToCsv } from "./marks";
import { bookFrom } from "./test-book";

const textOf = (book: Book, h: { block: string; start: number; end: number }) =>
  buildLookup(book).blocks.get(h.block)!.block.text.slice(h.start, h.end);

describe("findHits", () => {
  it("sucht ohne Groß-/Kleinschreibung über alle Kapitel", async () => {
    const book = await bookFrom("<p>Der Fluss war breit.</p>", "<p>Am Fluss standen sie. FLUSS!</p>");
    const { hits, truncated } = findHits(book, "fluss");
    expect(truncated).toBe(false);
    expect(hits.map((h) => [h.chapterIndex, textOf(book, h)])).toEqual([[0, "Fluss"], [1, "Fluss"], [1, "FLUSS"]]);
    expect(findHits(book, "f").hits).toEqual([]);
    expect(findHits(book, "fluss", 2)).toMatchObject({ truncated: true, hits: { length: 2 } });
  });

  it("behandelt Anführungszeichen, Apostrophe und Leerraum tolerant", async () => {
    const book = await bookFrom("<p>»Geh’ nicht«, sagte er. N'sakis   Boot (klein) lag da.</p>");
    expect(findHits(book, "geh' nicht").hits.map((h) => textOf(book, h))).toEqual(["Geh’ nicht"]);
    expect(findHits(book, "\"Geh").hits.map((h) => textOf(book, h))).toEqual(["»Geh"]);
    expect(findHits(book, "n'sakis boot (klein)").hits.map((h) => textOf(book, h))).toEqual(["N'sakis Boot (klein)"]);
  });

  it("liefert einen Ausschnitt an Wortgrenzen", () => {
    const text = "Lange vor dem Morgen verließ das Boot die Station und fuhr flussaufwärts in den Nebel hinein.";
    const i = text.indexOf("Station");
    const c = hitContext(text, i, i + 7, 20);
    expect(c.match).toBe("Station");
    expect(c.before.startsWith("…")).toBe(true);
    expect(c.after.endsWith("…")).toBe(true);
    expect(`${c.before}${c.match}${c.after}`.replace(/…/g, "")).toBe(text.slice(text.indexOf("das"), text.indexOf(" flussaufwärts")));
  });
});

describe("findSpeechSentence", () => {
  it("springt zur nächsten und vorherigen Redepassage einer Figur, auch über Kapitel", async () => {
    const book = await bookFrom(
      "<p>»Wohin?«, fragte Anna. Jonas schwieg.</p><p>»Nach Hause«, sagte Jonas. »Gut«, sagte Anna. »Und jetzt?«</p>",
      "<p>Es wurde Nacht.</p><p>»Schlaf«, sagte Anna.</p>",
    );
    const lookup = buildLookup(book);
    const [c0, c1] = book.chapters;
    const b0 = c0!.blocks[0]!.id;
    const b1 = c0!.blocks[1]!.id;
    const annaSpeech = book.annotations.filter((a) => a.type === "speech" && a.speaker === "anna");
    expect(annaSpeech.length).toBeGreaterThanOrEqual(3);

    const next = findSpeechSentence(book, lookup.byBlock, { chapterIndex: 0, block: b0, sentence: 0 }, 1, "anna");
    expect(next).toEqual({ chapterIndex: 0, block: b1, sentence: 1 });
    // »Gut«, sagte Anna. »Und jetzt?« – beide Anna, aber verschiedene Passagen
    const after = findSpeechSentence(book, lookup.byBlock, next!, 1, "anna")!;
    const last = findSpeechSentence(book, lookup.byBlock, after, 1, "anna")!;
    expect(last.chapterIndex).toBe(1);
    expect(last.block).toBe(c1!.blocks[1]!.id);
    expect(findSpeechSentence(book, lookup.byBlock, last, 1, "anna")).toBeNull();
    expect(findSpeechSentence(book, lookup.byBlock, last, -1, "anna")).toEqual(after);
    expect(findSpeechSentence(book, lookup.byBlock, { chapterIndex: 0, block: b0, sentence: 0 }, -1, "anna")).toBeNull();
  });
});

describe("listMarks", () => {
  it("listet Retakes, Lesezeichen und Notizen in Lesereihenfolge mit Satznummer", async () => {
    let book = await bookFrom("<p>Eins. Zwei; drei.</p><p>Vier. Fünf.</p>", "<p>Sechs.</p>");
    const [p1, p2] = book.chapters[0]!.blocks;
    const p3 = book.chapters[1]!.blocks[0]!;
    for (const mark of [
      { type: "note", block: p3.id, start: 0, end: 5, text: "leise; \"sehr\" leise" },
      { type: "retake", block: p2!.id, start: 6, end: 11 },
      { type: "bookmark", block: p1!.id, start: 0, end: 5 },
      { type: "emphasis", block: p1!.id, start: 6, end: 10 },
    ] as const) book = applyEdit(book, { type: "addMark", mark }).book;

    const rows = listMarks(book, buildLookup(book));
    expect(rows.map((r) => [r.type, r.chapterIndex, r.number, r.text, r.note])).toEqual([
      ["bookmark", 0, 1, "Eins.", ""],
      ["retake", 0, 4, "Fünf.", ""],
      ["note", 1, 1, "Sechs", "leise; \"sehr\" leise"],
    ]);
    const csv = marksToCsv(rows);
    expect(csv.startsWith("﻿Art;Kapitel;Kapiteltitel;Satz;Text;Notiz\r\n")).toBe(true);
    expect(csv).toContain(`;"leise; ""sehr"" leise"\r\n`);
  });
});
