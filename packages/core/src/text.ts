/**
 * Unicode-Helfer.
 *
 * In JavaScript sind `\w` und `\b` auch mit `u`-Flag reine ASCII-Klassen –
 * »Häuptling« zerfiele damit still in zwei Wörter. Alle Muster im Kern bauen
 * deshalb auf diesen Bausteinen auf, die Pythons Unicode-Semantik nachbilden.
 */

/** Inhalt einer Zeichenklasse für Pythons Unicode-`\w` (Buchstaben, Ziffern, `_`). */
export const W = String.raw`\p{L}\p{N}_`;

/** Nachbildung von Pythons `\b` (Unicode). */
export const B = String.raw`(?:(?<=[${W}])(?![${W}])|(?<![${W}])(?=[${W}]))`;

/** Pythons `[^\W\d_]` – Buchstaben und nicht-dezimale Zahlzeichen. */
export const LETTER = String.raw`[\p{L}\p{Nl}\p{No}]`;

const RE_WORD = new RegExp(`${LETTER}+`, "gu");

export function wordCount(text: string): number {
  RE_WORD.lastIndex = 0;
  let n = 0;
  while (RE_WORD.exec(text)) n++;
  return n;
}

export const isAlnum = (ch: string | undefined): boolean => !!ch && /^[\p{L}\p{N}]$/u.test(ch);
export const isAlpha = (ch: string | undefined): boolean => !!ch && /^\p{L}$/u.test(ch);
export const isLower = (ch: string | undefined): boolean => !!ch && /^\p{Ll}$/u.test(ch);
export const isUpper = (ch: string | undefined): boolean => !!ch && /^\p{Lu}$/u.test(ch);
export const isSpace = (ch: string | undefined): boolean => !!ch && /^\s$/u.test(ch);

/** Pythons `str.strip(chars)`. */
export function stripChars(s: string, chars: string): string {
  let a = 0;
  let z = s.length;
  while (a < z && chars.includes(s[a]!)) a++;
  while (z > a && chars.includes(s[z - 1]!)) z--;
  return s.slice(a, z);
}

/** Pythons `str.split()` ohne Argument. */
export function splitWs(s: string): string[] {
  const t = s.trim();
  return t ? t.split(/\s+/u) : [];
}

/**
 * `re.escape` für den Einbau in RegExp-Quelltext mit `u`-Flag. Dort sind nur
 * Syntaxzeichen escapebar – ein `\'` oder `\-` wäre ein Syntaxfehler.
 */
export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/** Pythons `str.capitalize()` (für die hier vorkommenden Fälle). */
export function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
}

/** Stabile Kennung aus einem Namen: »Miß Tibbetts« → »miss-tibbetts«. */
export function slug(s: string): string {
  const t = s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/ß/g, "ss")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return t || "x";
}

/** Vergleich nach Codepunkten wie Pythons `sorted()` für Strings. */
export function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
