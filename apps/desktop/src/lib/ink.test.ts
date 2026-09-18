import { describe, expect, it } from "vitest";
import { classifyStrike, fromInk, INK_STROKE, inkPath, simplify, toInk, touchedStrokes, type Pt } from "./ink";

const line = (x1: number, y1: number, x2: number, y2: number, n = 20): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => ({ x: x1 + ((x2 - x1) * i) / n, y: y1 + ((y2 - y1) * i) / n }));

describe("Handschrift aufbereiten", () => {
  it("simplify lässt Punkte auf einer Geraden weg, behält Ecken", () => {
    const corner = [...line(0, 0, 100, 0), ...line(100, 0, 100, 100).slice(1)];
    expect(simplify(corner, 1)).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
  });

  it("toInk schneidet oben und unten zu, rundet, begrenzt x; fromInk liest zurück", () => {
    const ink = toInk([line(100, 300, 600, 310), [{ x: 1200, y: 400.4 }]])!;
    expect(ink.w).toBe(INK_STROKE);
    // oberster Punkt (300) landet bei der Randbreite, der Punkt bekommt zwei gleiche Punkte
    expect(ink.strokes[0]!.slice(0, 2)).toEqual([100, INK_STROKE]);
    expect(ink.strokes[1]).toEqual([1000, 112, 1000, 112]);
    expect(ink.h).toBe(112 + INK_STROKE);
    expect(ink.strokes.flat().every(Number.isInteger)).toBe(true);
    expect(fromInk(ink)[1]).toEqual([{ x: 1000, y: 112 }, { x: 1000, y: 112 }]);
    expect(toInk([])).toBeNull();
  });

  it("inkPath glättet über Mittelpunkte und zeichnet Punkte als kurze Linie", () => {
    expect(inkPath([5, 5, 5, 5])).toBe("M5 5L5 5");
    expect(inkPath([0, 0, 10, 10, 20, 0])).toBe("M0 0Q10 10 15 5L20 0");
  });

  it("der Radierer trifft nur Striche in seiner Nähe", () => {
    const strokes = [line(0, 0, 100, 0), line(0, 50, 100, 50), [{ x: 200, y: 200 }]];
    expect([...touchedStrokes(strokes, [{ x: 50, y: 45 }], 8)]).toEqual([1]);
    expect([...touchedStrokes(strokes, [{ x: 203, y: 200 }, { x: 50, y: 2 }], 5)].sort()).toEqual([0, 2]);
  });
});

describe("Stiftgeste im Text", () => {
  const FONT = 21;
  const LINE = 21 * 1.8;

  it("erkennt einen waagerechten Strich, auch leicht schräg und von rechts nach links", () => {
    expect(classifyStrike(line(100, 200, 260, 206), FONT, LINE)).toEqual({ x1: 100, x2: 260, y: 203 });
    expect(classifyStrike(line(260, 210, 100, 200), FONT, LINE)).toMatchObject({ x1: 100, x2: 260 });
  });

  it("lehnt zu kurze, zu steile und gekritzelte Striche ab", () => {
    expect(classifyStrike(line(100, 200, 118, 200), FONT, LINE)).toBeNull();
    expect(classifyStrike(line(100, 200, 160, 240), FONT, LINE)).toBeNull();
    const scribble = [...line(100, 200, 200, 204), ...line(200, 204, 100, 208), ...line(100, 208, 200, 212)];
    expect(classifyStrike(scribble, FONT, LINE)).toBeNull();
    expect(classifyStrike([{ x: 1, y: 1 }], FONT, LINE)).toBeNull();
  });
});
