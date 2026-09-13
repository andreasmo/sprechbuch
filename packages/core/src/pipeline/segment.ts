/**
 * Satzsegmentierung (DE/EN), regelbasiert.
 *
 * Der Satz ist die Einheit, die der Sprecher atmet. Die Segmentierung muss
 * deshalb vor allem *keine* falschen Grenzen setzen: »…«, sagte er. ist ein
 * Satz, nicht zwei – nach dem schließenden Anführungszeichen folgt ein Komma.
 */
import { LETTER, isAlnum, isLower, isSpace, wordCount } from "../text.js";
import type { Doc } from "./types.js";

/** Abkürzungen, nach denen ein Punkt keine Satzgrenze ist. */
export const ABBREV = new Set([
  // deutsch
  "z", "b", "zb", "dh", "ua", "ggf", "bzw", "ca", "evtl", "usw", "usf", "vgl",
  "bspw", "inkl", "exkl", "max", "min", "mind", "sog", "u", "a", "d", "h",
  "nr", "abb", "tab", "kap", "bd", "jh", "jhd", "chr", "geb", "gest", "verst",
  "ebd", "ff", "f", "s", "str", "pl", "hrsg", "aufl", "od", "bzgl", "etc",
  "dr", "prof", "dipl", "ing", "med", "phil", "jur", "rer", "nat", "hc",
  "hr", "fr", "frl", "mr", "mrs", "ms", "st", "hl", "kl", "gr", "nachm",
  "vorm", "mio", "mrd", "tsd", "gez", "i", "v", "m", "e", "o", "n", "z.b",
  // englisch
  "mt", "jr", "sr", "vs", "eg", "ie", "approx", "dept", "univ", "co", "inc",
  "ltd", "cf", "al", "ed", "vol", "pp", "fig", "no", "esp",
]);

const MONTHS = new Set([
  "januar", "februar", "märz", "april", "mai", "juni", "juli", "august",
  "september", "oktober", "november", "dezember", "jänner",
  "january", "february", "march", "may", "june", "july", "october", "december",
]);

export const OPENERS = "«»„“”‘’‚‹›\"'([{–—-";
export const CLOSERS = "«»“”‘’‹›\"')]}";

const RE_END = /[.!?…]+/gu;
const RE_UPPER = /^[A-ZÄÖÜÁÀÂÉÈÊÍÎÓÔÚÛÑÇŠŽŁ0-9]/u;
const RE_FIRST_WORD = new RegExp(`${LETTER}+`, "u");

function prevToken(text: string, i: number): string {
  let j = i;
  while (j > 0 && (isAlnum(text[j - 1]) || "ÄÖÜäöüß.".includes(text[j - 1]!))) j--;
  return text.slice(j, i);
}

/** Satzgrenzen eines Blocks als [start, ende)-Offsets. */
export function sentenceSpans(text: string): [number, number][] {
  const spans: [number, number][] = [];
  const n = text.length;
  let start = 0;
  RE_END.lastIndex = 0;
  for (let m = RE_END.exec(text); m; m = RE_END.exec(text)) {
    const i = m.index;
    const j = i + m[0].length;
    const punct = m[0];

    let k = j;
    while (k < n && CLOSERS.includes(text[k]!)) k++;

    const rest = text.slice(k);
    const nxt = rest.trimStart();
    // Grenze nur vor Textende, Großbuchstabe, Ziffer oder öffnendem Zeichen
    if (nxt && !(RE_UPPER.test(nxt) || OPENERS.includes(nxt[0]!))) continue;
    if (nxt && rest && !isSpace(rest[0]) && k < n) {
      if (/[0-9]/.test(text[i - 1] ?? "") && /[0-9]/.test(nxt[0]!)) continue;
    }

    if (punct === ".") {
      const tok = prevToken(text, i).replace(/^\.+|\.+$/g, "").toLowerCase();
      if (ABBREV.has(tok) && tok.length <= 5) continue;
      if (tok.length === 1 && /^\p{L}$/u.test(tok)) continue; // Initialen: J. R. R.
      if (/^[0-9]+$/.test(tok) && nxt) {
        // Ordinalzahl / Datum: »am 3. Oktober«, »1. Kapitel«
        const w = RE_FIRST_WORD.exec(nxt);
        if (isLower(nxt[0]) || (w && MONTHS.has(w[0].toLowerCase()))) continue;
        if (tok.length <= 2 && Number(tok) <= 31) continue;
      }
    }

    if (punct.startsWith("…") || punct === "...") {
      if (!nxt || !(RE_UPPER.test(nxt) || "»„“\"".includes(nxt[0]!))) continue;
    }

    if (text.slice(start, k).trim()) spans.push([start, k]);
    start = k;
    while (start < n && isSpace(text[start])) start++;
  }
  if (start < n && text.slice(start).trim()) spans.push([start, n]);
  return spans;
}

/** Ergänzt Blöcke um Satzgrenzen, Satznummern und Wortzahlen. */
export function segmentDoc(doc: Doc): Doc {
  let idx = 0;
  for (const ch of doc.chapters) {
    let chIdx = 0;
    for (const b of ch.blocks) {
      b.words = wordCount(b.text);
      if (b.type === "h1" || b.type === "h2") {
        // Überschriften bekommen keine Satznummer.
        b.sent = [];
        b.sid = [];
        continue;
      }
      b.sent = sentenceSpans(b.text);
      b.sid = b.sent.map(() => {
        idx++;
        return ++chIdx;
      });
    }
    ch.n_sentences = chIdx;
  }
  doc.meta.n_sentences = idx;
  doc.meta.n_words = doc.chapters.reduce((a, c) => a + c.blocks.reduce((x, b) => x + (b.words ?? 0), 0), 0);
  return doc;
}
