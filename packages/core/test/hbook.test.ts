import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  BookFormatError, bookFromJson, bookStats, bookToJson, HBOOK_MIMETYPE, importBook, readHbook,
  SCHEMA_VERSION, sha256Fallback, sha256Hex, UnsupportedFormatError, validateBook, writeHbook, type Book,
} from "../src/index.js";
import { makeEpub } from "./helpers.js";

const STORY = [
  "<h1>Kapitel 1</h1>",
  "<p>Anna stand am Ufer und sah dem Boot nach.</p>",
  "<p>»Kommst du mit?«, fragte Anna. »Es wird bald <em>dunkel</em>.«</p>",
  "<p>»Gleich«, antwortete Jonas.</p>",
  "<p>»Du trödelst immer«, sagte sie.</p>",
].join("");

async function sampleBook(opts = {}) {
  const bytes = await makeEpub([{ file: "k1.xhtml", body: STORY }], { title: "Am Ufer", author: "Test" });
  return { bytes, ...(await importBook(bytes, "am-ufer.epub", opts)) };
}

describe("importBook", () => {
  it("erzeugt ein gültiges Buch mit Figuren, Markierungen und Quelle", async () => {
    const { book, bytes } = await sampleBook();
    expect(book.format).toBe("sprechbuch");
    expect(book.schemaVersion).toBe(SCHEMA_VERSION);
    expect(book.meta.source).toMatchObject({ fileName: "am-ufer.epub", format: "epub", size: bytes.byteLength, embedded: true });
    expect(book.meta.source.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(book.cast.map((c) => c.id).sort()).toEqual(["anna", "jonas"]);
    const speech = book.annotations.filter((a) => a.type === "speech");
    expect(speech).toHaveLength(4);
    expect(speech.every((a) => a.origin === "rule")).toBe(true);
    const para = book.chapters[0]!.blocks[2]!;
    expect(para.format).toEqual([{ start: para.text.indexOf("dunkel"), end: para.text.indexOf("dunkel") + 6, kind: "em" }]);
    expect(() => validateBook(JSON.parse(bookToJson(book)))).not.toThrow();
  });

  it("meldet Fortschritt in Stufen", async () => {
    const stages: string[] = [];
    await sampleBook({ onProgress: (s: string) => stages.push(s) });
    expect(stages).toEqual(["read", "sentences", "speech", "speakers", "colors", "book"]);
  });

  it("lehnt Word und Unbekanntes mit klarer Meldung ab", async () => {
    const docx = new JSZip();
    docx.file("word/document.xml", "<w:document/>");
    const bytes = await docx.generateAsync({ type: "uint8array" });
    await expect(importBook(bytes, "x.docx")).rejects.toThrow(/Word/);
    await expect(importBook(new TextEncoder().encode("hallo"), "x.txt")).rejects.toBeInstanceOf(UnsupportedFormatError);
  });

  it("Statistik zählt Verfahren und Prüfbedarf", async () => {
    const { book } = await sampleBook();
    const s = bookStats(book);
    expect(s.speech).toBe(4);
    expect(s.byVia).toMatchObject({ inquit_after: 2, same_paragraph: 1, pronoun: 1 });
    expect(s.cast.find((c) => c.id === "anna")!.lines).toBe(3);
  });
});

describe(".hbook-Container", () => {
  it("Round-Trip erhält Buch und Originaldatei", async () => {
    const { book, bytes } = await sampleBook();
    const hbook = await writeHbook(book, bytes);
    const back = await readHbook(hbook);
    expect(back.book).toEqual(book);
    expect(back.source?.bytes).toEqual(bytes);
  });

  it("mimetype steht zuerst und unkomprimiert", async () => {
    const { book } = await sampleBook();
    const hbook = await writeHbook(book, null);
    const head = new TextDecoder().decode(hbook.slice(30, 38 + HBOOK_MIMETYPE.length));
    expect(head).toBe(`mimetype${HBOOK_MIMETYPE}`);
  });

  it("ohne eingebettete Quelle bleibt source null", async () => {
    const { book, bytes } = await sampleBook({ embedSource: false });
    const back = await readHbook(await writeHbook(book, bytes));
    expect(back.source).toBeNull();
  });

  it("Übergabe-Protokoll: wird mitgeschrieben, gelesen, beschädigt ignoriert", async () => {
    const { book, bytes } = await sampleBook();
    const base = await sha256Hex(await writeHbook(book, bytes));
    const changes = { base, device: "iPad", updatedAt: "2026-09-15T08:00:00.000Z", edits: [{ edit: { type: "confirmSpeech" as const, ids: ["a000001"] } }] };
    const back = await readHbook(await writeHbook(book, bytes, changes));
    expect(back.changes).toEqual(changes);
    expect(back.book).toEqual(book);
    expect((await readHbook(await writeHbook(book, bytes))).changes).toBeNull();

    // Beschädigt: Buch bleibt lesbar, Protokoll fehlt; unvollständige Befehle → edits null
    const zip = await JSZip.loadAsync(await writeHbook(book, bytes));
    zip.file("changes.json", "{kaputt");
    expect((await readHbook(await zip.generateAsync({ type: "uint8array" }))).changes).toBeNull();
    zip.file("changes.json", JSON.stringify({ format: "sprechbuch-changes", version: 1, base, device: "iPad", updatedAt: "", edits: [{ nix: 1 }] }));
    expect((await readHbook(await zip.generateAsync({ type: "uint8array" }))).changes).toMatchObject({ base, edits: null });
  });

  it("SHA-256 ohne Web Crypto ergibt dasselbe", async () => {
    for (const input of ["", "abc", "x".repeat(55), "x".repeat(56), "x".repeat(64), "»Rede« ".repeat(500)]) {
      const bytes = new TextEncoder().encode(input);
      const hex = [...sha256Fallback(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
      expect(hex).toBe(await sha256Hex(bytes));
    }
    expect([...sha256Fallback(new TextEncoder().encode("abc"))].map((b) => b.toString(16).padStart(2, "0")).join(""))
      .toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("unbekannte Felder (Erweiterungen) überleben Lesen und Schreiben", async () => {
    const { book } = await sampleBook();
    const extended = { ...book, x_studio: { take: 3 }, cast: book.cast.map((c) => ({ ...c, x_voice: "tief" })) } as Book;
    const again = bookFromJson(bookToJson(extended)) as Book & { x_studio: unknown };
    expect(again.x_studio).toEqual({ take: 3 });
    expect((again.cast[0] as Record<string, unknown>).x_voice).toBe("tief");
  });

  it("Stiftfarben und Handschrift: Round-Trip, gleiche Formatversion", async () => {
    const { book } = await sampleBook();
    const block = book.chapters[0]!.blocks[1]!.id;
    const ink = { h: 180, w: 9, strokes: [[0, 10, 400, 30, 820, 12]] };
    const marked: Book = {
      ...book,
      emphasisLabels: ["langsamer", "", "leiser"],
      annotations: [
        ...book.annotations,
        { type: "emphasis", id: "a000900", block, start: 0, end: 4, color: 2, origin: "user" },
        { type: "note", id: "a000901", block, start: 5, end: 10, text: "", ink, origin: "user" },
      ],
    };
    const { book: again } = await readHbook(await writeHbook(marked));
    expect(again.schemaVersion).toBe(1);
    expect(again.emphasisLabels).toEqual(["langsamer", "", "leiser"]);
    expect(again.annotations.at(-1)).toMatchObject({ type: "note", text: "", ink });
    expect(() => validateBook({ ...marked, annotations: [...marked.annotations.slice(0, -1), { ...marked.annotations.at(-1)!, ink: { h: 1, w: 1, strokes: [[1]] } }] }))
      .toThrow(BookFormatError);
  });
});

describe("Validierung und Migration", () => {
  const broken = async (mutate: (b: any) => void) => {
    const { book } = await sampleBook();
    const raw = JSON.parse(bookToJson(book));
    mutate(raw);
    return () => bookFromJson(JSON.stringify(raw));
  };

  it("neuere Formatversion wird mit Hinweis abgelehnt", async () => {
    expect(await broken((b) => (b.schemaVersion = SCHEMA_VERSION + 1))).toThrow(/neueren Sprechbuch-Version/);
  });

  it("fremde Dateien, doppelte IDs und kaputte Verweise werden erkannt", async () => {
    expect(await broken((b) => (b.format = "etwas"))).toThrow(BookFormatError);
    expect(await broken((b) => (b.annotations[1].id = b.annotations[0].id))).toThrow(/doppelt/);
    expect(await broken((b) => (b.annotations[0].speaker = "niemand"))).toThrow(/unbekannte Figur/);
    expect(await broken((b) => (b.annotations[0].end = 99999))).toThrow(/außerhalb/);
    expect(await broken((b) => (b.annotations[0].block = "b99999"))).toThrow(/unbekannten Block/);
    expect(await broken((b) => delete b.meta.title)).toThrow(/meta\.title/);
  });

  it("keine .hbook-Datei", async () => {
    await expect(readHbook(new Uint8Array([0, 1, 2]))).rejects.toThrow(/kein gültiges ZIP/);
    const zip = new JSZip();
    zip.file("mimetype", "application/zip");
    await expect(readHbook(await zip.generateAsync({ type: "uint8array" }))).rejects.toThrow(/mimetype/);
  });
});
