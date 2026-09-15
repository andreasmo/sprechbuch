import { describe, expect, it } from "vitest";
import { applyEdit, rebaseEdits, validateBook, type Annotation, type Book, type Edit, type JournalEntry } from "../src/index.js";
import { sampleBook } from "./helpers.js";

const NOW = new Date("2026-09-14T12:00:00Z");
const find = (book: Book, id: string) => book.annotations.find((a) => a.id === id);

/** Befehle nacheinander anwenden und wie die App ein Journal mitschreiben. */
function run(book: Book, edits: Edit[]): { book: Book; journal: JournalEntry[] } {
  const journal: JournalEntry[] = [];
  for (const edit of edits) {
    const res = applyEdit(book, edit, NOW);
    book = res.book;
    journal.push({ edit, ...(res.created ? { created: res.created } : {}) });
  }
  return { book, journal };
}

describe("rebaseEdits", () => {
  it("überträgt eigene Änderungen auf eine anderswo weiterbearbeitete Fassung", async () => {
    const { book: base } = await sampleBook();
    const block3 = base.chapters[0]!.blocks[2]!.id;
    const block8 = base.chapters[1]!.blocks[1]!.id;
    expect(base.chapters[1]!.blocks[1]!.sentences).toEqual([[0, 27], [28, 52]]);

    // Anderes Gerät: Sprecher gesetzt, Retake gesetzt (belegt die nächste ID), Rede entfernt, Satz geteilt
    const theirs = run(base, [
      { type: "setSpeaker", ids: ["a000004"], speaker: "jonas" },
      { type: "addMark", mark: { type: "retake", block: block3, start: 0, end: 16 } },
      { type: "removeAnnotation", id: "a000005" },
      { type: "splitSentence", block: block8, at: 16 },
    ]).book;

    // Hier: Notiz gesetzt und danach geändert, dieselbe Rede entfernt, anderer Sprecher,
    // neue Figur angelegt und zugeordnet, Satzgrenze entfernt
    const mine = run(base, [
      { type: "addMark", mark: { type: "note", block: block3, start: 18, end: 30, text: "fragend" } },
      { type: "setNote", id: "a000008", text: "fragend, leise" },
      { type: "removeAnnotation", id: "a000005" },
      { type: "setSpeaker", ids: ["a000004"], speaker: "paul" },
      { type: "addCast", name: "Marie" },
      { type: "setSpeaker", ids: ["a000006"], speaker: "marie" },
      { type: "mergeSentences", block: block8, index: 0, at: 28 },
    ]);
    expect(mine.journal[0]!.created).toBe("a000008");

    const res = rebaseEdits(theirs, mine.journal, NOW);
    expect(res.skipped).toEqual([]);
    expect(res.unchanged.map((e) => e.type)).toEqual(["removeAnnotation"]);
    expect(res.applied.map((a) => a.edit.type)).toEqual(["addMark", "setNote", "setSpeaker", "addCast", "setSpeaker", "mergeSentences"]);

    const book = res.book;
    expect(() => validateBook(JSON.parse(JSON.stringify(book)))).not.toThrow();
    // Beide Markierungen vorhanden; die Notiz hat eine neue ID, setNote wurde umgeschrieben
    const retake = book.annotations.find((a) => a.type === "retake")!;
    const note = book.annotations.find((a) => a.type === "note") as Extract<Annotation, { type: "note" }>;
    expect(retake.id).toBe("a000008");
    expect(note.id).toBe("a000009");
    expect(note.text).toBe("fragend, leise");
    expect(res.applied[1]!.edit).toMatchObject({ type: "setNote", id: "a000009" });
    // Eigene Entscheidung gewinnt
    expect(find(book, "a000004")).toMatchObject({ speaker: "paul", origin: "user" });
    expect(find(book, "a000005")).toBeUndefined();
    expect(find(book, "a000006")).toMatchObject({ speaker: "marie" });
    // Satzgrenze über den Offset gefunden, nicht über die veraltete Nummer
    expect(book.chapters[1]!.blocks[1]!.sentences).toEqual([[0, 15], [16, 52]]);
  });

  it("überspringt, was nicht mehr passt, und erkennt Erledigtes", async () => {
    const { book: base } = await sampleBook();
    const block3 = base.chapters[0]!.blocks[2]!.id;
    const theirs = run(base, [
      { type: "removeAnnotation", id: "a000004" },
      { type: "addMark", mark: { type: "bookmark", block: block3, start: 0, end: 16 } },
    ]).book;
    const mine = run(base, [
      { type: "addMark", mark: { type: "bookmark", block: block3, start: 0, end: 16 } },
      { type: "setSpeaker", ids: ["a000004"], speaker: "paul" },
    ]);
    const res = rebaseEdits(theirs, mine.journal, NOW);
    expect(res.applied).toEqual([]);
    expect(res.unchanged.map((e) => e.type)).toEqual(["addMark"]);
    expect(res.skipped).toEqual([{ edit: mine.journal[1]!.edit, label: "Sprecher geändert", reason: "Unbekannte Markierung: a000004" }]);
    expect(res.book).toBe(theirs);
  });

  it("verschiedene Notizen am selben Satz gehen beide nicht verloren", async () => {
    const { book: base } = await sampleBook();
    const block = base.chapters[0]!.blocks[2]!.id;
    const note = (text: string): Edit => ({ type: "addMark", mark: { type: "note", block, start: 0, end: 16, text } });
    const theirs = run(base, [note("leiser")]).book;
    const mine = run(base, [note("leiser"), note("Tempo raus")]);
    const res = rebaseEdits(theirs, mine.journal, NOW);
    expect(res.unchanged).toHaveLength(1);
    expect(res.applied).toHaveLength(1);
    expect(res.book.annotations.filter((a) => a.type === "note").map((a) => (a as { text: string }).text).sort()).toEqual(["Tempo raus", "leiser"]);
  });
});
