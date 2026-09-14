import { applyEdit, type Book } from "@sprechbuch/core";
import { describe, expect, it } from "vitest";
import { breathChunks, chapterSentences, renderBlock, sentenceAt, sentenceNumbers, snapSelection, stripFinalPeriod, type Segment } from "./render";
import { bookFrom } from "./test-book";

function render(book: Book, blockIndex = 0) {
  const ch = book.chapters[0]!;
  const block = ch.blocks[blockIndex]!;
  const cast = new Map(book.cast.map((c) => [c.id, c]));
  return renderBlock(book, ch.id, block, book.annotations.filter((a) => a.block === block.id), cast);
}

/** Kompakte Darstellung: [Kürzel:Text] für Rede, {s0}…{/s} für Sätze, ^ für Punktmarken */
const show = (segs: Segment[]) =>
  segs.map((s) => (s.sentence === null ? "" : `{s${s.sentence}}`) + s.pieces.map((p) =>
    p.kind === "point" ? (p.mark === "breath" ? "^" : p.long ? "//" : "/")
      : p.speech ? `[${p.speech.badge ?? ""}:${p.text}]` : p.text).join("")).join("");

describe("stripFinalPeriod", () => {
  it("entfernt den Schlusspunkt, auch vor schließendem Anführungszeichen", () => {
    expect(stripFinalPeriod("Er ging.")).toBe("Er ging");
    expect(stripFinalPeriod("»…und die Lenden.«")).toBe("»…und die Lenden«");
    expect(stripFinalPeriod("Wirklich?")).toBe("Wirklich?");
    expect(stripFinalPeriod("Kein Punkt")).toBe("Kein Punkt");
  });
});

describe("renderBlock", () => {
  it("gruppiert nach Sätzen, Kürzel am Anfang jeder Redepassage, Offsets bleiben original", async () => {
    const book = await bookFrom("<p>»Kommst du mit?«, fragte Anna. »Es wird bald dunkel.« Jonas nickte.</p>");
    const segs = render(book);
    expect(show(segs)).toBe("{s0}[An:»Kommst du mit?«], fragte Anna {s1}[An:»Es wird bald dunkel«] {s2}Jonas nickte");
    expect(segs.map((s) => [s.sentence, s.start, s.end])).toEqual([[0, 0, 30], [null, 30, 31], [1, 31, 53], [null, 53, 54], [2, 54, 67]]);
    const last = segs[4]!.pieces.at(-1)!;
    expect(last.kind === "text" && [last.start, last.end]).toEqual([54, 67]);
    expect(segs[0]!.pieces.filter((p) => p.kind === "text" && p.speech).every((p) => p.kind === "text" && p.speech!.speaker === "anna")).toBe(true);
  });

  it("zeigt Pausen, Atemzeichen, Betonung, Retake und Notizen an den richtigen Stellen", async () => {
    let book = await bookFrom("<p>Er stand auf. Dann ging er <em>langsam</em> hinaus.</p>");
    const block = book.chapters[0]!.blocks[0]!.id;
    for (const mark of [
      { type: "pause", block, at: 13, length: "long" },
      { type: "breath", block, at: 5 },
      { type: "emphasis", block, start: 3, end: 8 },
      { type: "note", block, start: 14, end: 18, text: "zögernd" },
      { type: "retake", block, start: 14, end: 42 },
    ] as const) {
      book = applyEdit(book, { type: "addMark", mark }).book;
    }
    const segs = render(book);
    expect(show(segs)).toBe("{s0}Er st^and auf// {s1}Dann ging er langsam hinaus");
    const pieces = segs.flatMap((s) => s.pieces).filter((p) => p.kind === "text");
    const find = (t: string) => pieces.find((p) => p.kind === "text" && p.text === t)!;
    expect(find("and").kind === "text" && find("and").emphasis).toBe(true);
    const dann = find("Dann");
    expect(dann.kind === "text" && dann.starts?.map((s) => s.type)).toEqual(["note", "retake"]);
    expect(dann.kind === "text" && dann.starts?.[0]!.text).toBe("zögernd");
    const langsam = find("langsam");
    expect(langsam.kind === "text" && [langsam.italic, langsam.retake, langsam.note]).toEqual([true, true, undefined]);
  });

  it("Überschriften ohne Sätze sind ein einziges Segment", async () => {
    const book = await bookFrom("<h1>Kapitel 1</h1><p>Text.</p>");
    expect(render(book).map((s) => [s.sentence, s.start, s.end])).toEqual([[null, 0, 9]]);
    expect(chapterSentences(book.chapters[0]!)).toEqual([{ block: book.chapters[0]!.blocks[1]!.id, sentence: 0, start: 0, end: 5, words: 1 }]);
  });
});

describe("Atemstellen und Satznummern", () => {
  it("zerlegt an Komma, Semikolon, Doppelpunkt und frei stehendem Gedankenstrich", () => {
    const text = "Ja, sagte er; dann – nach einer Weile: Halb-Mond.";
    const chunks = breathChunks(text, 100)!;
    expect(chunks.filter((c) => c.breath).map((c) => c.text)).toEqual([",", ";", "–", ":"]);
    expect(chunks.map((c) => c.text).join("")).toBe(text);
    for (const c of chunks) expect(text.slice(c.start - 100, c.end - 100)).toBe(c.text);
    expect(breathChunks("Halb-Mond ohne Pause", 0)).toBeNull();
  });

  it("zählt Sätze kapitelweit und findet den Satz zu einem Offset", async () => {
    const book = await bookFrom("<p>Eins. Zwei.</p><p>Drei. Vier. Fünf.</p>");
    const ch = book.chapters[0]!;
    const nums = sentenceNumbers(ch);
    expect(ch.blocks.map((b) => nums.get(b.id))).toEqual([1, 3]);
    const b = ch.blocks[1]!;
    expect([sentenceAt(b, 0), sentenceAt(b, 6), sentenceAt(b, 5), sentenceAt(b, 99)]).toEqual([0, 1, 1, 2]);
    expect(render(book, 1).map((s) => s.words)).toEqual([1, 0, 1, 0, 1]);
  });
});

describe("snapSelection", () => {
  const t = "»Makara, der Häuptling«, sagte er.";
  const pick = (s: number, e: number, q = false) => { const [a, b] = snapSelection(t, s, e, q); return t.slice(a, b); };
  it("erweitert angeschnittene Wörter und kürzt Leerraum", () => {
    expect(pick(3, 12)).toBe("Makara, der");
    expect(pick(8, 14)).toBe("der Häuptling");
    expect(pick(13, 13)).toBe("");
  });
  it("nimmt für Rede die Anführungszeichen mit", () => {
    expect(pick(1, 22, true)).toBe("»Makara, der Häuptling«");
    expect(pick(3, 20, true)).toBe("»Makara, der Häuptling«");
    expect(pick(26, 31, true)).toBe("sagte");
  });
});
