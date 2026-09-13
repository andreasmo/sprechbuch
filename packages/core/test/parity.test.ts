/**
 * Parität mit der Python-Referenz.
 *
 * Läuft nur, wenn in fixtures/local ein EPUB samt <name>.golden.json liegt
 * (erzeugt mit `npm run golden`). Die Bücher selbst werden nicht committet.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyze, importEpub } from "../src/index.js";

const DIR = fileURLToPath(new URL("../../../fixtures/local", import.meta.url));
const books = existsSync(DIR)
  ? readdirSync(DIR).filter((f) => f.endsWith(".epub") && existsSync(join(DIR, f.replace(/\.epub$/, ".golden.json"))))
  : [];

const prepared = await Promise.all(books.map(async (file) => ({
  file,
  golden: JSON.parse(readFileSync(join(DIR, file.replace(/\.epub$/, ".golden.json")), "utf8")),
  doc: analyze(await importEpub(readFileSync(join(DIR, file)), file)),
})));

const round = (n: number | null | undefined) => (typeof n === "number" ? Math.round(n * 1000) / 1000 : n);

describe.skipIf(books.length === 0)("Parität mit Python-Referenz", () => {
  for (const { file, golden, doc } of prepared) {
    describe(file, () => {

      it("Metadaten und Umfang", () => {
        expect(doc.meta.quote_style).toEqual(golden.meta.quote_style);
        expect(doc.meta.n_sentences).toBe(golden.meta.n_sentences);
        expect(doc.meta.n_words).toBe(golden.meta.n_words);
        expect(doc.chapters.map((c) => c.id)).toEqual(golden.chapters.map((c: { id: string }) => c.id));
        expect(doc.chapters.map((c) => c.title)).toEqual(golden.chapters.map((c: { title: string }) => c.title));
      });

      it("Blocktext identisch", () => {
        const ts = doc.chapters.flatMap((c) => c.blocks.map((b) => `${b.type}|${b.text}`));
        const py = golden.chapters.flatMap((c: any) => c.blocks.map((b: any) => `${b.type}|${b.text}`));
        expect(ts.length).toBe(py.length);
        const firstDiff = ts.findIndex((t, i) => t !== py[i]);
        expect(firstDiff === -1 ? null : { i: firstDiff, ts: ts[firstDiff], py: py[firstDiff] }).toBeNull();
      });

      it("Satzgrenzen identisch", () => {
        const ts = doc.chapters.flatMap((c) => c.blocks.map((b) => JSON.stringify(b.sent)));
        const py = golden.chapters.flatMap((c: any) => c.blocks.map((b: any) => JSON.stringify(b.sent)));
        const firstDiff = ts.findIndex((t, i) => t !== py[i]);
        expect(firstDiff === -1 ? null : { i: firstDiff, ts: ts[firstDiff], py: py[firstDiff] }).toBeNull();
      });

      it("Redespannen und Sprecherzuordnung identisch", () => {
        const norm = (sp: any) => [sp.s, sp.e, sp.cont, sp.inner, sp.open_end, sp.speaker ?? null, round(sp.conf), sp.via ?? null];
        const ts = doc.chapters.flatMap((c) => c.blocks.flatMap((b, bi) => (b.speech ?? []).map((sp) => `${c.id}#${bi} ${JSON.stringify(norm(sp))}`)));
        const py = golden.chapters.flatMap((c: any) => c.blocks.flatMap((b: any, bi: number) => b.speech.map((sp: any) => `${c.id}#${bi} ${JSON.stringify(norm(sp))}`)));
        expect(ts.length).toBe(py.length);
        const diffs = ts.map((t, i) => (t !== py[i] ? { ts: t, py: py[i] } : null)).filter(Boolean);
        expect(diffs.slice(0, 5)).toEqual([]);
      });

      it("Figuren, Farben und Kürzel identisch", () => {
        const norm = (c: any) => ({ id: c.id, name: c.name, aliases: c.aliases, gender: c.gender, lines: c.lines,
          words: c.words, chapters: c.chapters, kind: c.kind, slot: c.slot, badge: c.badge });
        expect(doc.cast!.map(norm)).toEqual(golden.cast.map(norm));
        expect(doc.chapter_colors).toEqual(golden.chapter_colors);
      });
    });
  }
});
