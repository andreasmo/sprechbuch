import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bookStats, readHbook, validateBook } from "../src/index.js";

const EXAMPLE = new URL("../../../examples/effi-briest/effi-briest-kapitel-1.hbook", import.meta.url);

describe("Mitgeliefertes Beispiel", () => {
  it("Effi Briest, erstes Kapitel: gültig, mit Quelle, mehreren Figuren und Rede", async () => {
    const { book, source } = await readHbook(new Uint8Array(readFileSync(EXAMPLE)));
    expect(() => validateBook(JSON.parse(JSON.stringify(book)))).not.toThrow();
    expect(book.meta).toMatchObject({ title: "Effi Briest – Erstes Kapitel", author: "Theodor Fontane", language: "de" });
    expect(source?.fileName).toBe("effi-briest-kapitel-1.epub");
    const stats = bookStats(book);
    expect(stats.speech).toBeGreaterThan(50);
    expect(book.cast.map((c) => c.name)).toEqual(expect.arrayContaining(["Effi", "Hulda", "Hertha", "Bertha"]));
  });
});
