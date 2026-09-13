import { describe, expect, it } from "vitest";
import { detectQuoteStyle, findSpeech, QUOTE_STYLES, segmentDoc, type Doc } from "../src/index.js";
import { docFrom } from "./helpers.js";

const doc1 = (paras: string[]): Doc => ({
  meta: {},
  chapters: [{ id: "ch001", src: "", title: "", blocks: paras.map((text) => ({ type: "p" as const, text, marks: [] })) }],
});

/** Sprecher je Redeteil als [Redetext, Figur, Verfahren]. */
const speakers = (doc: Doc) =>
  doc.chapters[0]!.blocks.flatMap((b) =>
    (b.speech ?? []).filter((s) => !s.inner).map((s) => [b.text.slice(s.s, s.e), s.speaker ?? null, s.via ?? null]));

describe("Anführungsstil", () => {
  it("erkennt deutsche Guillemets, „…“ und gerade Anführungszeichen", () => {
    const many = (o: string, c: string) => doc1(Array.from({ length: 6 }, (_, i) => `${o}Satz ${i}${c}, sagte er.`));
    expect(detectQuoteStyle(many("»", "«")).name).toBe("guillemets_de");
    expect(detectQuoteStyle(many("«", "»")).name).toBe("guillemets_fr");
    expect(detectQuoteStyle(many("„", "“")).name).toBe("low_high_de");
    expect(detectQuoteStyle(many('"', '"')).name).toBe("straight");
    expect(detectQuoteStyle(doc1(["Nur Erzähltext."])).name).toBe("none");
  });

  it("findet Zitate in der Rede und offene Rede über Absätze", () => {
    const d = segmentDoc(doc1(["»Er sagte ›nein‹ und ging«, erzählte sie.", "»Das ist eine lange Rede", "»und sie geht weiter.«"]));
    findSpeech(d, QUOTE_STYLES.guillemets_de);
    const [b0, b1, b2] = d.chapters[0]!.blocks;
    expect(b0!.speech!.map((s) => [s.inner, b0!.text.slice(s.s, s.e)])).toEqual([[false, "»Er sagte ›nein‹ und ging«"], [true, "›nein‹"]]);
    expect(b1!.speech![0]!.open_end).toBe(true);
    expect(b2!.speech![0]!.cont).toBe(true);
  });
});

describe("Sprecherzuordnung", () => {
  it("Inquit, Absatzbindung, Pronomen, Wechselrede, Nähe und Anrede", () => {
    const d = docFrom([
      "Anna stand am Ufer und sah dem Boot nach.",
      "»Kommst du mit?«, fragte Anna. »Es wird bald dunkel.«",
      "»Gleich«, antwortete Jonas.",
      "»Du trödelst immer«, sagte sie.",
      "»Und du bist ungeduldig.«",
      "Jonas lachte.",
      "»Na gut, ich komme.«",
      "»Jonas, beeil dich!«",
    ]);
    expect(speakers(d)).toEqual([
      ["»Kommst du mit?«", "anna", "inquit_after"],
      ["»Es wird bald dunkel.«", "anna", "same_paragraph"],
      ["»Gleich«", "jonas", "inquit_after"],
      ["»Du trödelst immer«", "anna", "pronoun"],
      ["»Und du bist ungeduldig.«", "jonas", "alternation"],
      ["»Na gut, ich komme.«", "jonas", "proximity"],
      // Jonas wird angeredet – also spricht Anna
      ["»Jonas, beeil dich!«", "anna", "alternation"],
    ]);
  });

  it("Inquit vor der Rede und Ich-Erzähler", () => {
    const d = docFrom(["Der Kapitän sagte: »Leinen los!«", "»Aye«, sagte ich."]);
    expect(speakers(d)).toEqual([
      ["»Leinen los!«", "kapitan", "inquit_before"],
      ["»Aye«", "ich-erzahler", "pronoun"],
    ]);
  });

  it("führt Namensvarianten zusammen, aber nicht bei widersprüchlicher Anrede", () => {
    const d = docFrom([
      "»Wir fahren morgen«, sagte Captain Hamilton.",
      "»Gut«, sagte Hamilton.", "»Sehr gut«, sagte Hamilton.",
      "»Ich komme mit«, sagte Miß Tibbetts.",
      "»Ich auch«, sagte Leutnant Tibbetts.",
    ]);
    const cast = Object.fromEntries(d.cast!.map((c) => [c.id, c]));
    expect(cast.hamilton!.lines).toBe(3);
    expect(cast.hamilton!.aliases).toEqual(["Captain Hamilton"]);
    expect(cast["captain-hamilton"]).toBeUndefined();
    expect(cast["miss-tibbetts"]).toBeDefined();
    expect(cast["leutnant-tibbetts"]).toBeDefined();
  });

  it("Figurenvorgabe: Alias verdrängt den gleichnamigen Eintrag, Farbe bleibt fest", () => {
    const d = docFrom(
      ["»Hallo«, sagte Leutnant Tibbetts.", "»Tag«, sagte Sanders.", "»Na«, sagte Bones."],
      { cast: [{ id: "bones", name: "Bones", aliases: ["Leutnant Tibbetts"], color: 5 }, { name: "Leutnant Tibbetts" }] },
    );
    expect(speakers(d).map((s) => s[1])).toEqual(["bones", "sanders", "bones"]);
    expect(d.cast!.find((c) => c.id === "bones")!.slot).toBe(5);
    expect(d.cast!.some((c) => c.id === "leutnant-tibbetts")).toBe(false);
  });

  it("vergibt kapitelweise Farben ohne Kollision mit dem Hauptcast", () => {
    const lines = Array.from({ length: 4 }, (_, i) => `»Satz ${i}«, sagte Anna.`);
    const d = docFrom([...lines, "»Einmal«, sagte Paul."]);
    const anna = d.cast!.find((c) => c.id === "anna")!;
    expect(anna.slot).toBe(0);
    expect(d.cast!.find((c) => c.id === "paul")!.slot).toBeNull();
    expect(d.chapter_colors!.ch001).toEqual({ paul: 1 });
  });
});
