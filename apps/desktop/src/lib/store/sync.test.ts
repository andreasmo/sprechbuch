import type { Book } from "@sprechbuch/core";
import { describe, expect, it } from "vitest";
import { isAbsolutePath, siblingPath } from "../platform/types";
import { decideOpen, mayHaveChanged } from "./sync";

const book = {} as Book;
const stamp = (sha: string) => ({ size: 10, modifiedMs: 1, sha256: sha });

describe("decideOpen", () => {
  it("ohne Schnappschuss gilt die Datei", () => {
    expect(decideOpen(undefined, "aaa")).toEqual({ action: "file" });
  });

  it("gleiche Datei → Schnappschuss mit ungespeicherten Änderungen weiterführen", () => {
    expect(decideOpen({ book, dirty: true, fileStamp: stamp("aaa"), journal: [] }, "aaa")).toEqual({ action: "resume" });
    expect(decideOpen({ book, dirty: false, fileStamp: stamp("aaa") }, "aaa")).toEqual({ action: "resume" });
  });

  it("andere Fassung ohne eigene Änderungen → Datei laden", () => {
    expect(decideOpen({ book, dirty: false, fileStamp: stamp("aaa") }, "bbb")).toEqual({ action: "file" });
  });

  it("beide geändert → Konflikt, zusammenführbar nur mit Journal", () => {
    expect(decideOpen({ book, dirty: true, fileStamp: stamp("aaa"), journal: [] }, "bbb")).toEqual({ action: "conflict", canMerge: true });
    expect(decideOpen({ book, dirty: true, fileStamp: stamp("aaa"), journal: null }, "bbb")).toEqual({ action: "conflict", canMerge: false });
    // Schnappschuss aus älterer Version ohne Stempel
    expect(decideOpen({ book, dirty: true }, "bbb")).toEqual({ action: "conflict", canMerge: false });
    // Web: Datei ohne Hash
    expect(decideOpen({ book, dirty: true, fileStamp: stamp("aaa"), journal: [] }, undefined)).toEqual({ action: "conflict", canMerge: true });
  });
});

describe("mayHaveChanged", () => {
  it("vergleicht Größe und Änderungszeit", () => {
    expect(mayHaveChanged(null, { size: 1, modifiedMs: 1 })).toBe(true);
    expect(mayHaveChanged({ size: 1, modifiedMs: 1, sha256: "x" }, { size: 1, modifiedMs: 1 })).toBe(false);
    expect(mayHaveChanged({ size: 1, modifiedMs: 1 }, { size: 1, modifiedMs: 2 })).toBe(true);
  });
});

describe("Pfade", () => {
  it("erkennt absolute Pfade und bildet Nachbarpfade", () => {
    expect(["C:\\Bücher\\a.epub", "D:/x.pdf", "\\\\nas\\buch.hbook", "/home/a/b.epub"].map(isAbsolutePath)).toEqual([true, true, true, true]);
    expect(["a.hbook", "Bücher\\a.hbook", ""].map(isAbsolutePath)).toEqual([false, false, false]);
    expect(siblingPath("C:\\Bücher\\Am Strom.epub", "Am Strom.hbook")).toBe("C:\\Bücher\\Am Strom.hbook");
    expect(siblingPath("/home/a/strom.pdf", "strom.hbook")).toBe("/home/a/strom.hbook");
    expect(siblingPath("strom.pdf", "strom.hbook")).toBe("strom.hbook");
  });
});
