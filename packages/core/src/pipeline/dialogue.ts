/** Direkte Rede: Anführungsstil bestimmen und Redespannen finden. */
import type { Doc, QuoteStyle, SpeechSpan } from "./types.js";

const INNER_PAIRS: [string, string][] = [["‚", "‘"], ["›", "‹"], ["‹", "›"]];
const DASH_START = /^\s*[–—]\s+/u;

export const QUOTE_STYLES: Record<Exclude<QuoteStyle["name"], "none">, QuoteStyle> = {
  guillemets_de: { open: "»", close: "«", name: "guillemets_de" },
  guillemets_fr: { open: "«", close: "»", name: "guillemets_fr" },
  low_high_de: { open: "„", close: "“", name: "low_high_de" },
  curly_en: { open: "“", close: "”", name: "curly_en" },
  straight: { open: '"', close: '"', name: "straight" },
  dash: { open: "—", close: "", name: "dash" },
};

const count = (text: string, ch: string) => text.split(ch).length - 1;

/**
 * Ermittelt den dominanten Anführungsstil des Dokuments.
 *
 * Abweichung von der Referenz: Die verlangte »> 10 Zeichen« pro Stil; kurze
 * Texte bekamen dadurch gar keine Redeerkennung. Hier gewinnt der Stil mit den
 * meisten Paaren (Gleichstand in der Reihenfolge Guillemets, „…“, “…”, "…").
 */
export function detectQuoteStyle(doc: Doc): QuoteStyle {
  const text = doc.chapters.flatMap((c) => c.blocks.map((b) => b.text)).join("\n");
  const score = {
    guillemets: Math.min(count(text, "»"), count(text, "«")),
    low: count(text, "„"),
    curly: count(text, "”"),
    straight: Math.floor(count(text, '"') / 2),
  };
  const best = Math.max(...Object.values(score));

  // Guillemets: Reihenfolge des ersten Auftretens entscheidet über die Richtung
  if (best > 0 && score.guillemets === best) {
    let de = 0;
    let fr = 0;
    for (const ch of doc.chapters) {
      for (const b of ch.blocks) {
        const a = b.text.indexOf("»");
        const z = b.text.indexOf("«");
        if (a >= 0 && z >= 0) {
          if (a < z) de++;
          if (z < a) fr++;
        }
      }
    }
    return de >= fr ? QUOTE_STYLES.guillemets_de : QUOTE_STYLES.guillemets_fr;
  }
  if (best > 0 && score.low === best) {
    const close = count(text, "“") >= count(text, "”") ? "“" : "”";
    return { open: "„", close, name: "low_high_de" };
  }
  if (best > 0 && score.curly === best) return QUOTE_STYLES.curly_en;
  if (best > 0 && score.straight === best) return QUOTE_STYLES.straight;

  const paras = doc.chapters.flatMap((c) => c.blocks.filter((b) => b.type === "p"));
  const dash = paras.filter((b) => DASH_START.test(b.text)).length;
  if (dash / (paras.length || 1) > 0.2) return QUOTE_STYLES.dash;
  return { open: "", close: "", name: "none" };
}

function spansPaired(text: string, o: string, c: string): SpeechSpan[] {
  const out: SpeechSpan[] = [];
  const n = text.length;
  const mk = (s: number, e: number, open_end: boolean): SpeechSpan =>
    ({ s, e, open_end, cont: false, inner: false });
  if (o === c) {
    // gerade Anführungszeichen: abwechselnd öffnen/schließen
    const pos: number[] = [];
    for (let i = text.indexOf(o); i >= 0; i = text.indexOf(o, i + 1)) pos.push(i);
    for (let i = 0; i + 1 < pos.length; i += 2) out.push(mk(pos[i]!, pos[i + 1]! + 1, false));
    if (pos.length % 2) out.push(mk(pos[pos.length - 1]!, n, true));
    return out;
  }
  let i = 0;
  while (i < n) {
    const a = text.indexOf(o, i);
    if (a < 0) break;
    const b = text.indexOf(c, a + 1);
    if (b < 0) {
      out.push(mk(a, n, true));
      break;
    }
    out.push(mk(a, b + 1, false));
    i = b + 1;
  }
  return out;
}

function spansDash(text: string): SpeechSpan[] {
  const m = DASH_START.exec(text);
  if (!m) return [];
  let end = text.length;
  const after = m.index + m[0].length;
  const m2 = /\s[–—]\s/u.exec(text.slice(after));
  if (m2) end = after + m2.index;
  return [{ s: m.index, e: end, open_end: false, cont: false, inner: false }];
}

/** Ergänzt jeden Block um `speech` und setzt `meta.quote_style`. */
export function findSpeech(doc: Doc, style?: QuoteStyle): Doc {
  const st = style ?? detectQuoteStyle(doc);
  doc.meta.quote_style = st;
  for (const ch of doc.chapters) {
    let carry = false; // offene Rede aus dem vorigen Absatz
    for (const b of ch.blocks) {
      if (b.type === "h1" || b.type === "h2" || !st.open) {
        b.speech = [];
        continue;
      }
      const spans = st.name === "dash" ? spansDash(b.text) : spansPaired(b.text, st.open, st.close);
      spans.forEach((sp, i) => {
        sp.cont = carry && i === 0;
        sp.inner = false;
      });
      // verschachtelte Zitate innerhalb der Rede
      for (const [io, ic] of INNER_PAIRS) {
        for (const sp of spansPaired(b.text, io, ic)) {
          if (spans.some((x) => x.s < sp.s && sp.e <= x.e)) {
            sp.cont = false;
            sp.inner = true;
            spans.push(sp);
          }
        }
      }
      spans.sort((x, y) => x.s - y.s || y.e - x.e);
      b.speech = spans;
      const last = spans[spans.length - 1];
      carry = !!last && last.open_end && !last.inner;
    }
  }
  return doc;
}
