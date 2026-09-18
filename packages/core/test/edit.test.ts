import { describe, expect, it } from "vitest";
import {
  applyBookPatches, applyEdit, bookStats, describeEdit, EditError, reviewQueue, setProgress, validateBook,
  type Annotation, type Book, type Edit,
} from "../src/index.js";
import { sampleBook } from "./helpers.js";

const NOW = new Date("2026-09-14T10:00:00Z");
const ann = (book: Book, id: string) => book.annotations.find((a) => a.id === id)!;
const speech = (book: Book, id: string) => ann(book, id) as Extract<Annotation, { type: "speech" }>;

/** Wendet an, prüft Gültigkeit und dass die Gegen-Patches exakt zum Ausgangsbuch zurückführen. */
function apply(book: Book, edit: Edit) {
  const res = applyEdit(book, edit, NOW);
  expect(() => validateBook(JSON.parse(JSON.stringify(res.book)))).not.toThrow();
  expect(applyBookPatches(res.book, res.inverse)).toEqual(book);
  expect(applyBookPatches(book, res.patches)).toEqual(res.book);
  return res;
}

describe("Sprecher", () => {
  it("setSpeaker macht die Zuordnung zur Nutzerentscheidung und entfernt sie aus der Prüfung", async () => {
    const { book } = await sampleBook();
    expect(reviewQueue(book).map((a) => a.id)).toEqual(["a000004", "a000005"]);
    const { book: next } = apply(book, { type: "setSpeaker", ids: ["a000004"], speaker: "jonas" });
    expect(speech(next, "a000004")).toMatchObject({ speaker: "jonas", origin: "user", confidence: 1 });
    expect(reviewQueue(next).map((a) => a.id)).toEqual(["a000005"]);
    expect(next.meta.modifiedAt).toBe(NOW.toISOString());
    expect(bookStats(next).byVia.user).toBe(1);
  });

  it("confirmSpeech bestätigt ohne den Sprecher zu ändern", async () => {
    const { book } = await sampleBook();
    const { book: next } = apply(book, { type: "confirmSpeech", ids: ["a000004", "a000005"] });
    expect(speech(next, "a000004")).toMatchObject({ speaker: "anna", origin: "user", confidence: 1 });
    expect(reviewQueue(next)).toEqual([]);
  });

  it("neue Figur im Kapitel bekommt dort eine freie Farbe", async () => {
    const { book } = await sampleBook();
    const { book: b1 } = apply(book, { type: "setSpeaker", ids: ["a000005"], speaker: "paul" });
    // Anna hat fest Gelb (0), Jonas im Kapitel Grün (1) → Paul bekommt Pink (2)
    expect(b1.chapterColors.ch002).toEqual({ jonas: 1, paul: 2 });
    expect(b1.chapterColors.ch003).toEqual({ paul: 1 });
  });

  it("unbekannte Figur und falscher Markierungstyp werden abgelehnt", async () => {
    const { book } = await sampleBook();
    expect(() => applyEdit(book, { type: "setSpeaker", ids: ["a000004"], speaker: "niemand" })).toThrow(EditError);
    expect(() => applyEdit(book, { type: "setSpeaker", ids: ["x"], speaker: null })).toThrow(/Unbekannte Markierung/);
  });
});

describe("Rede markieren, teilen, entfernen", () => {
  it("addSpeech kürzt Leerraum, ersetzt überlappende Rede und liefert die neue ID", async () => {
    const { book } = await sampleBook();
    // »Guten Morgen«, sagte Paul. Er setzte sich zu ihnen.  – ganzen Absatz neu als Rede von Anna
    const res = apply(book, { type: "addSpeech", block: "b00008", start: 0, end: 52, speaker: "anna" });
    expect(res.created).toBe("a000008");
    const inBlock = res.book.annotations.filter((a) => a.block === "b00008");
    expect(inBlock).toHaveLength(1);
    expect(inBlock[0]).toMatchObject({ start: 0, end: 52, speaker: "anna", origin: "user" });
    // Paul spricht in Kapitel 2 nicht mehr → keine Kapitelfarbe mehr
    expect(res.book.chapterColors.ch003).toBeUndefined();
  });

  it("splitSpeech teilt an Leerraum und vergibt den neuen Sprecher", async () => {
    const { book } = await sampleBook();
    // »Und du bist ungeduldig.« – nach »Und du « teilen
    const res = apply(book, { type: "splitSpeech", id: "a000005", at: 7, speaker: "anna" });
    expect(speech(res.book, "a000005")).toMatchObject({ start: 0, end: 7 });
    expect(speech(res.book, res.created!)).toMatchObject({ start: 8, end: 25, speaker: "anna", origin: "user" });
    expect(() => applyEdit(book, { type: "splitSpeech", id: "a000005", at: 0, speaker: null })).toThrow(/geteilt/);
  });

  it("removeAnnotation entfernt und räumt Kapitelfarben auf", async () => {
    const { book } = await sampleBook();
    const { book: b1 } = apply(book, { type: "removeAnnotation", id: "a000003" });
    const { book: b2 } = apply(b1, { type: "removeAnnotation", id: "a000005" });
    expect(b2.annotations.some((a) => a.id === "a000003" || a.id === "a000005")).toBe(false);
    expect(b2.chapterColors.ch002).toBeUndefined();
  });

  it("ungültige Bereiche werden abgelehnt", async () => {
    const { book } = await sampleBook();
    expect(() => applyEdit(book, { type: "addSpeech", block: "b00004", start: 5, end: 3, speaker: null })).toThrow(/ungültiger Bereich/);
    expect(() => applyEdit(book, { type: "addSpeech", block: "b00004", start: 0, end: 999, speaker: null })).toThrow(/ungültiger Bereich/);
    expect(() => applyEdit(book, { type: "addSpeech", block: "b99999", start: 0, end: 1, speaker: null })).toThrow(/Unbekannter Absatz/);
  });
});

describe("Aufnahme-Markierungen", () => {
  it("Betonung, Retake, Lesezeichen, Notiz, Pause, Atem", async () => {
    let { book } = await sampleBook();
    const marks: Edit[] = [
      { type: "addMark", mark: { type: "emphasis", block: "b00002", start: 5, end: 10 } },
      { type: "addMark", mark: { type: "retake", block: "b00002", start: 0, end: 41, note: "zu schnell" } },
      { type: "addMark", mark: { type: "bookmark", block: "b00004", start: 0, end: 27 } },
      { type: "addMark", mark: { type: "note", block: "b00005", start: 0, end: 20, text: "genervt" } },
      { type: "addMark", mark: { type: "pause", block: "b00002", at: 18, length: "long" } },
      { type: "addMark", mark: { type: "breath", block: "b00003", at: 30 } },
    ];
    const ids: string[] = [];
    for (const m of marks) {
      const res = apply(book, m);
      ids.push(res.created!);
      book = res.book;
    }
    expect(ids).toEqual(["a000008", "a000009", "a000010", "a000011", "a000012", "a000013"]);
    expect(ann(book, "a000009")).toMatchObject({ type: "retake", note: "zu schnell", origin: "user" });
    const { book: b2 } = apply(book, { type: "setNote", id: "a000011", text: "eher müde" });
    expect(ann(b2, "a000011")).toMatchObject({ text: "eher müde" });
    expect(() => applyEdit(b2, { type: "setNote", id: "a000008", text: "x" })).toThrow(/Notizen und Retakes/);
    expect(describeEdit(marks[1]!)).toBe("Retake markiert");
  });
});

describe("Farbige Betonungen", () => {
  it("Farbe setzen, umfärben, schlicht machen; dieselbe Stelle färbt um statt zu stapeln", async () => {
    let { book } = await sampleBook();
    const add = (color?: number | null) => apply(book, { type: "addMark", mark: { type: "emphasis", block: "b00002", start: 5, end: 10, color } });
    const first = add(2);
    book = first.book;
    expect(ann(book, first.created!)).toMatchObject({ type: "emphasis", color: 2, origin: "user" });

    const again = add(0);
    expect(again.created).toBe(first.created);
    expect(again.book.annotations.filter((a) => a.type === "emphasis")).toHaveLength(1);
    expect(ann(again.book, first.created!)).toMatchObject({ color: 0 });
    // Gleiche Farbe noch einmal: keine Änderung, kein Rückgängig-Schritt
    expect(applyEdit(again.book, { type: "addMark", mark: { type: "emphasis", block: "b00002", start: 5, end: 10, color: 0 } }, NOW).patches).toEqual([]);

    const plain = apply(again.book, { type: "setEmphasisColor", id: first.created!, color: null });
    expect(ann(plain.book, first.created!)).not.toHaveProperty("color");
    expect(() => applyEdit(book, { type: "setEmphasisColor", id: first.created!, color: 99 }, NOW)).toThrow(/Stiftfarbe/);
    expect(() => applyEdit(book, { type: "setEmphasisColor", id: "a000001", color: 1 }, NOW)).toThrow(/keine Betonung/);
    expect(() => applyEdit(book, { type: "addMark", mark: { type: "emphasis", block: "b00002", start: 0, end: 4, color: 1.5 } }, NOW)).toThrow(/Stiftfarbe/);
  });

  it("Bedeutungen je Buch: setzen, kürzen, leer entfernt das Feld", async () => {
    const { book } = await sampleBook();
    const a = apply(book, { type: "setEmphasisLabel", color: 2, label: "  langsamer   werden " });
    expect(a.book.emphasisLabels).toEqual(["", "", "langsamer werden"]);
    const b = apply(a.book, { type: "setEmphasisLabel", color: 0, label: "leiser" });
    expect(b.book.emphasisLabels).toEqual(["leiser", "", "langsamer werden"]);
    const c = apply(b.book, { type: "setEmphasisLabel", color: 2, label: "" });
    expect(c.book.emphasisLabels).toEqual(["leiser"]);
    const d = apply(c.book, { type: "setEmphasisLabel", color: 0, label: " " });
    expect(d.book).not.toHaveProperty("emphasisLabels");
    expect(applyEdit(d.book, { type: "setEmphasisLabel", color: 0, label: "" }, NOW).patches).toEqual([]);
    expect(() => applyEdit(book, { type: "setEmphasisLabel", color: 5, label: "x" }, NOW)).toThrow(/Stiftfarbe/);
  });

  it("unbekannte Farben aus einer neueren Version bleiben lesbar", async () => {
    const { book } = await sampleBook();
    const raw = JSON.parse(JSON.stringify(book)) as Book;
    raw.annotations.push({ type: "emphasis", id: "a000900", block: "b00002", start: 0, end: 4, color: 17, origin: "user" });
    expect(() => validateBook(raw)).not.toThrow();
  });
});

describe("Handschriftliche Notizen", () => {
  const ink = { h: 240, w: 9, strokes: [[10, 20, 60, 25, 110, 22], [30, 80, 32, 140]] };

  it("Notiz mit Handschrift anlegen, ändern, Handschrift entfernen", async () => {
    const { book } = await sampleBook();
    const add: Edit = { type: "addMark", mark: { type: "note", block: "b00004", start: 0, end: 10, text: "", ink } };
    expect(describeEdit(add)).toBe("Handschriftliche Notiz hinzugefügt");
    const a = apply(book, add);
    const id = a.created!;
    expect(ann(a.book, id)).toMatchObject({ type: "note", text: "", ink });
    // Übernommen wird eine Kopie – spätere Änderungen am Eingabeobjekt ändern das Buch nicht
    expect((ann(a.book, id) as { ink: typeof ink }).ink.strokes[0]).not.toBe(ink.strokes[0]);

    const b = apply(a.book, { type: "setInk", id, ink: { h: 100, w: 12, strokes: [[0, 0, 900, 90]] } });
    expect(ann(b.book, id)).toMatchObject({ ink: { h: 100, w: 12 } });
    const c = apply(b.book, { type: "setInk", id, ink: null });
    expect(ann(c.book, id)).not.toHaveProperty("ink");
    expect(describeEdit({ type: "setInk", id, ink: null })).toBe("Handschrift entfernt");
    expect(() => applyEdit(book, { type: "setInk", id: "a000001", ink }, NOW)).toThrow(/Nur Notizen/);
  });

  it("kaputte oder übergroße Handschrift wird abgelehnt", async () => {
    const { book } = await sampleBook();
    const note = (bad: unknown) => () => applyEdit(book, { type: "addMark", mark: { type: "note", block: "b00004", start: 0, end: 10, text: "", ink: bad as typeof ink } }, NOW);
    expect(note({ h: 100, w: 9, strokes: [[1, 2, 3]] })).toThrow(/Ungültige Handschrift/);
    expect(note({ h: 0, w: 9, strokes: [[1, 2]] })).toThrow(/Ungültige Handschrift/);
    expect(note({ h: 100, w: 9, strokes: [] })).toThrow(/Ungültige Handschrift/);
    expect(note({ h: 100, w: 9, strokes: [[1.5, 2]] })).toThrow(/Ungültige Handschrift/);
    expect(note({ h: 100, w: 9, strokes: [Array.from({ length: 40_002 }, () => 1)] })).toThrow(/zu umfangreich/);
  });
});

describe("Satzgrenzen", () => {
  it("verbinden und wieder teilen ergibt den Ausgangszustand", async () => {
    const { book } = await sampleBook();
    const merged = apply(book, { type: "mergeSentences", block: "b00003", index: 0 }).book;
    expect(merged.chapters[0]!.blocks[2]!.sentences).toEqual([[0, 53]]);
    const split = apply(merged, { type: "splitSentence", block: "b00003", at: 30 }).book;
    expect(split.chapters[0]!.blocks[2]!.sentences).toEqual([[0, 30], [31, 53]]);
    expect(() => applyEdit(book, { type: "mergeSentences", block: "b00004", index: 0 })).toThrow(/keine Satzgrenze/);
    expect(() => applyEdit(book, { type: "splitSentence", block: "b00004", at: 0 })).toThrow(/Keine Satzgrenze/);
  });

  it("Leseposition bleibt nach dem Verbinden gültig und landet nicht in Patches", async () => {
    const { book } = await sampleBook();
    const withProgress = setProgress(book, "b00003", 1);
    expect(withProgress.progress).toEqual({ block: "b00003", sentence: 1 });
    expect(setProgress(withProgress, "b00003", 1)).toBe(withProgress);
    const merged = applyEdit(withProgress, { type: "mergeSentences", block: "b00003", index: 0 }, NOW).book;
    expect(merged.progress).toEqual({ block: "b00003", sentence: 0 });
  });
});

describe("Figuren", () => {
  it("anlegen, vorhandene Namen/Aliasse wiederverwenden, eindeutige IDs", async () => {
    const { book } = await sampleBook();
    const a = apply(book, { type: "addCast", name: "  Frau   Berger " });
    expect(a.created).toBe("frau-berger");
    expect(a.book.cast.at(-1)).toMatchObject({ name: "Frau Berger", badge: "FB", color: null, origin: "user" });
    expect(applyEdit(a.book, { type: "addCast", name: "anna" }, NOW).created).toBe("anna");
    const b = apply(a.book, { type: "updateCast", id: "frau-berger", name: "Frau-Berger" });
    expect(apply(b.book, { type: "addCast", name: "Frau Berger" }).created).toBe("frau-berger-2");
  });

  it("umbenennen passt automatisches Kürzel an, eigenes Kürzel bleibt", async () => {
    const { book } = await sampleBook();
    const r1 = apply(book, { type: "updateCast", id: "jonas", name: "Jonas Keller", voiceNote: "tief", aliases: ["der Junge", " der Junge "] });
    expect(r1.book.cast.find((c) => c.id === "jonas")).toMatchObject({ name: "Jonas Keller", badge: "JK", voiceNote: "tief", aliases: ["der Junge"] });
    const r2 = apply(r1.book, { type: "updateCast", id: "jonas", badge: "Jon" });
    const r3 = apply(r2.book, { type: "updateCast", id: "jonas", name: "Jo" });
    expect(r3.book.cast.find((c) => c.id === "jonas")!.badge).toBe("Jon");
  });

  it("Farbe setzen tauscht mit der bisherigen Trägerin und löst Kapitelkonflikte", async () => {
    const { book } = await sampleBook();
    // Jonas bekommt Gelb – das hat Anna; Anna bekommt Jonas' bisheriges »null« und damit eine Kapitelfarbe
    const { book: next } = apply(book, { type: "setCastColor", id: "jonas", color: 0 });
    const byId = Object.fromEntries(next.cast.map((c) => [c.id, c.color]));
    expect(byId).toMatchObject({ jonas: 0, anna: null });
    expect(next.chapterColors.ch002).toEqual({ anna: 1 });
    // Jonas spricht in Kapitel 2 nicht – dort ist Gelb frei
    expect(next.chapterColors.ch003).toEqual({ paul: 1, anna: 0 });
  });

  it("zusammenführen übernimmt Redeteile, Aliasse und Farbe", async () => {
    const { book } = await sampleBook();
    const { book: next } = apply(book, { type: "mergeCast", from: "anna", into: "paul" });
    expect(next.cast.map((c) => c.id)).toEqual(["jonas", "paul"]);
    const paul = next.cast.find((c) => c.id === "paul")!;
    expect(paul).toMatchObject({ aliases: ["Anna"], color: 0, origin: "user" });
    expect(next.annotations.filter((a) => a.type === "speech" && a.speaker === "anna")).toEqual([]);
    expect(next.chapterColors.ch003).toBeUndefined();
    expect(() => applyEdit(book, { type: "mergeCast", from: "anna", into: "anna" })).toThrow(/mit sich selbst/);
  });
});

describe("Aussprache", () => {
  it("Hinweis und Prüfvermerk setzen", async () => {
    const { book } = await sampleBook();
    const term = book.pronunciations[0]!.term;
    const { book: next } = apply(book, { type: "updatePronunciation", term, hint: "AN-na", verified: true });
    expect(next.pronunciations[0]).toMatchObject({ hint: "AN-na", verified: true, origin: "user" });
  });
});
