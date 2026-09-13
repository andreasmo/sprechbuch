import { describe, expect, it } from "vitest";
import { B, escapeRe, initials, sentenceSpans, slug, wordCount } from "../src/index.js";

const sentences = (t: string) => sentenceSpans(t).map(([a, z]) => t.slice(a, z));

describe("Unicode-Helfer", () => {
  it("zählt Wörter mit Umlauten als ein Wort", () => {
    expect(wordCount("Der Häuptling grüßte Müller.")).toBe(4);
  });

  it("Wortgrenze respektiert Umlaute (JS-\\b täte das nicht)", () => {
    expect(new RegExp(`${B}Häuptling${B}`, "u").test("der Häuptling kam")).toBe(true);
    expect(new RegExp(`${B}ling${B}`, "u").test("Häuptling")).toBe(false);
  });

  it("escapeRe erzeugt gültige u-Regex auch mit Apostroph und Bindestrich", () => {
    expect(() => new RegExp(escapeRe("M'anin Ich-Erzähler (x)"), "u")).not.toThrow();
    expect(new RegExp(escapeRe("a.b"), "u").test("axb")).toBe(false);
  });

  it("slug und Kürzel", () => {
    expect(slug("Miß Tibbetts")).toBe("miss-tibbetts");
    expect(slug("Ärger Ödön")).toBe("arger-odon");
    expect(initials("Bones")).toBe("Bo");
    expect(initials("Leutnant Tibbetts")).toBe("LT");
    expect(initials("M'anin")).toBe("M'");
  });
});

describe("Satzgrenzen", () => {
  it("Abkürzungen, Titel und Datumsangaben trennen nicht", () => {
    expect(sentences("Das kostet z. B. zehn Euro. Dr. Meier kam am 3. Oktober an. Er ging.")).toEqual([
      "Das kostet z. B. zehn Euro.", "Dr. Meier kam am 3. Oktober an.", "Er ging.",
    ]);
  });

  it("Inquit nach der Rede bleibt im selben Satz", () => {
    expect(sentences("»Ich sehe dich«, sagte er. Dann ging er.")).toEqual(["»Ich sehe dich«, sagte er.", "Dann ging er."]);
    expect(sentences("»Kommst du?«, fragte sie.")).toEqual(["»Kommst du?«, fragte sie."]);
  });

  it("Satzzeichen vor schließendem Anführungszeichen trennt vor Großbuchstabe", () => {
    expect(sentences("»Warte!« Er drehte sich um.")).toEqual(["»Warte!«", "Er drehte sich um."]);
  });

  it("Auslassung, Initialen und Dezimalzahlen", () => {
    expect(sentences("Er zögerte... dann lief er.")).toHaveLength(1);
    expect(sentences("J. R. R. Tolkien schrieb viel.")).toHaveLength(1);
    expect(sentences("Pi ist etwa 3.14 groß.")).toHaveLength(1);
  });
});
