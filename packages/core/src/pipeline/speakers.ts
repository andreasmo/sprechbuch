/**
 * Sprecherzuordnung für direkte Rede (DE/EN), regelbasiert.
 *
 * Verfahren in absteigender Verlässlichkeit (`via`):
 *   inquit_after      »…«, sagte Makara                      0.95 (Nominalphrase 0.75)
 *   inquit_before     Makara sagte: »…«                      0.90
 *   same_paragraph    anderer Redeteil im Absatz ist belegt  0.70
 *   continuation      Fortsetzung eines Redeblocks           0.70
 *   pronoun           »…«, sagte er  → aufgelöst             0.55–0.60
 *   inquit_paragraph  Inquit weiter vorn im Absatz           0.50
 *   proximity         Erzählabsatz davor nennt eine Figur    0.45
 *   alternation       Wechselrede                            0.35–0.40
 *
 * Port von `reference/python/hbprep/speakers.py`; Paritätstest in
 * `test/parity.test.ts`.
 */
import { B, W, cmpStr, escapeRe, slug, splitWs, stripChars, wordCount } from "../text.js";
import type { CastMember, CastPreset, Doc, InquitHit, SpeechSpan, SubjectKind } from "./types.js";

// --------------------------------------------------------------------------- //
// Lexika
// --------------------------------------------------------------------------- //
const VERBS_DE = `
sagte sagt sagten spricht sprach sprachen rief ruft riefen fragte fragt fragten
antwortete antwortet erwiderte erwidert entgegnete entgegnet meinte meint
flüsterte flüstert wisperte raunte tuschelte murmelte murmelt brummte brummelte
knurrte grollte murrte maulte seufzte stöhnte ächzte keuchte schnaubte prustete
lachte kicherte grinste schrie brüllte kreischte zischte fauchte hauchte
stammelte stotterte plapperte erklärte erklärt erläuterte versicherte beteuerte
behauptete bemerkte ergänzte fügte setzte wiederholte begann beginnt fuhr
unterbrach befahl gebot mahnte warnte drohte spottete höhnte witzelte scherzte
jammerte klagte wimmerte schluchzte gestand stimmte nickte widersprach
protestierte beharrte drängte bat flehte forderte verlangte wandte versetzte
begrüßte verabschiedete dachte denkt überlegte staunte wunderte log erzählte
berichtete verkündete betonte bestätigte erinnerte tröstete brüllt lispelte
schmunzelte kommentierte frohlockte japste stieß`;
const VERBS_EN = `
said says replied replies answered answers asked asks cried cries shouted
whispered murmured muttered growled snapped exclaimed added continued began
remarked observed noted sighed laughed chuckled gasped breathed hissed groaned
moaned stammered insisted agreed protested admitted confessed declared announced
explained urged warned ordered commanded offered thought mused ventured echoed
repeated called yelled screamed wondered demanded interrupted put went`;

const VERBS = [...new Set(splitWs(VERBS_DE + " " + VERBS_EN))].sort((a, b) => b.length - a.length);
const INQUIT_SRC = `${B}(?:${VERBS.map(escapeRe).join("|")})${B}`;

const PRONOUNS: Record<string, string> = {
  er: "m", he: "m", ihn: "m", ihm: "m",
  sie: "f", she: "f", ihr: "f",
  es: "n", it: "n",
  ich: "1", i: "1",
  man: "?", wir: "?", we: "?", they: "?", du: "?", you: "?",
};

const ART = "(?:[Dd]er|[Dd]ie|[Dd]as|[Dd]en|[Dd]em|[Ee]in|[Ee]ine|[Ee]inen|[Ee]inem|"
  + "[Ee]iner|[Ss]ein|[Ss]eine[nmr]?|[Ii]hr|[Ii]hre[nmr]?|[Tt]he|[Aa]|[Aa]n|[Hh]is|[Hh]er|[Mm]y)";
const TITLE = "(?:Herr|Frau|Fräulein|Frl|Miß|Miss|Mrs|Mr|Ms|Dr|Prof|Professor|Sir|Lady|"
  + "Lord|König|Königin|Prinz|Prinzessin|Graf|Gräfin|Häuptling|Hauptmann|"
  + "Kapitän|Captain|Leutnant|Lieutenant|Major|Colonel|Oberst|Sergeant|Onkel|"
  + "Tante|Vater|Mutter|Bruder|Schwester|Doktor|Pater|General|Admiral)\\.?";
const CAP = `[A-ZÄÖÜ][${W}ÄÖÜäöüß'’\\-]+`;
/** Name: optionaler Titel, Kernname, optionales Adelsprädikat, ein Zusatzwort. */
const NAME = `(?:${TITLE}\\s+)?${CAP}(?:\\s+(?:von|van|de|della|ibn)\\s+${CAP})?(?:\\s+${CAP})?`;
/** Nominalphrase: Artikel + Adjektive + großgeschriebenes Nomen (filtert »der andere stolz«). */
const NP = `${ART}\\s+(?:[a-zäöüß]{2,}\\s+){0,2}${CAP}`;
const ADV = "(?:\\s+(?:dann|nun|noch|schon|leise|laut|ruhig|plötzlich|nur|auch|jetzt|"
  + "wieder|endlich|kurz|langsam|hastig|then|now|softly|quietly|suddenly))?";
const PRON = "(er|sie|es|ich|man|du|wir|he|she|i|they|we|you)";

const RE_SUBJ_HEAD: [SubjectKind, RegExp][] = [
  ["pron", new RegExp(`^\\s*(?:${ADV})?\\s*${PRON}${B}`, "iu")],
  ["np", new RegExp(`^\\s*(?:${ADV})?\\s*(${NP})`, "u")],
  ["name", new RegExp(`^\\s*(?:${ADV})?\\s*(${NAME})`, "u")],
];
const RE_SUBJ_TAIL: [SubjectKind, RegExp][] = [
  ["np", new RegExp(`(${NP})\\s*$`, "u")],
  ["name", new RegExp(`(${NAME})\\s*$`, "u")],
  ["pron", new RegExp(`${B}${PRON}\\s*$`, "iu")],
];
const RE_NAME_ALL = new RegExp(NAME, "gu");

export const TITLE_WORDS = new Set((TITLE.match(/[A-Za-zÄÖÜäöüß]+/g) ?? []).map((t) => t.toLowerCase()));
const TITLES_M = new Set(["herr", "hr", "mr", "mister", "sir", "lord", "könig", "prinz", "graf",
  "vater", "bruder", "sohn", "onkel", "opa", "großvater", "häuptling",
  "hauptmann", "kapitän", "leutnant", "doktor", "pfarrer", "junge", "mann",
  "bursche", "alte", "fremde", "wirt", "bauer", "knecht", "diener"]);
const TITLES_F = new Set(["frau", "fr", "mrs", "miss", "ms", "lady", "königin", "prinzessin",
  "gräfin", "mutter", "schwester", "tochter", "tante", "oma", "großmutter",
  "mädchen", "dame", "wirtin", "magd", "dienerin", "alte"]);

/** Großgeschriebene Satzanfänge, die nie ein Sprechername sind. */
export const STOP_NAMES = new Set(splitWs(`
und aber denn doch oder als wenn dann da so ja nein ach oh o nun jetzt heute
gestern wieder einmal eines plötzlich endlich schließlich später dabei damit
deshalb darauf dennoch trotzdem natürlich vielleicht nur noch schon erst immer
selbst etwas nichts niemand jemand alle beide viele einige hier dort dies diese
dieser dieses jener jene jenes nachdem während bevor seit ohne gegen über unter
nach bei vor aus um an auf am im in von zu mit für wie weil ob was wer wo warum
wieso weshalb wohin woher der die das den dem des ein eine einen einem einer
sein seine ihr ihre mein meine dein unser euer man es kein keine nicht sehr
zwar sogar wenigstens immerhin kurz lange leise laut
and but then so now well there this that these those he she it they we you i
the a an his her their our my your what when where why how because although`));

/** Verben, die eine Antwort einleiten: »erwiderte er« meint den Gesprächspartner. */
const RESPONSE_VERBS = new Set(["erwiderte", "erwidert", "entgegnete", "entgegnet", "antwortete",
  "antwortet", "versetzte", "widersprach", "protestierte",
  "replied", "answered", "retorted", "objected", "protested"]);

// --------------------------------------------------------------------------- //
// Subjekt- und Inquit-Erkennung
// --------------------------------------------------------------------------- //
function cleanNp(t: string): string {
  const s = t.trim().replace(new RegExp(`^\\s*(?:${ART})\\s+`, "u"), "");
  return stripChars(s.replace(/\s+/gu, " "), " ,.;:!?–—-");
}

function subject(seg: string, head: boolean): { surface: string; kind: SubjectKind } | null {
  for (const [kind, rx] of head ? RE_SUBJ_HEAD : RE_SUBJ_TAIL) {
    const m = rx.exec(seg);
    if (!m) continue;
    const surface = m[1]!.trim();
    if (kind === "pron") return { surface: surface.toLowerCase(), kind };
    if (kind === "name") {
      if (surface.toLowerCase() in PRONOUNS) return { surface: surface.toLowerCase(), kind: "pron" };
      const first = stripChars(splitWs(surface)[0]!.toLowerCase(), ".,;:");
      if (STOP_NAMES.has(first) || surface.length < 3) continue;
      return { surface: stripChars(surface, " ,.;:"), kind };
    }
    const np = cleanNp(surface);
    const words = splitWs(np);
    if (words.length === 1 && STOP_NAMES.has(words[0]!.toLowerCase())) continue;
    return { surface: np, kind };
  }
  return null;
}

function inquit(segIn: string, window = 90, backward = false): InquitHit | null {
  let seg = segIn.trim();
  if (!seg) return null;
  seg = seg.replace(/^[\s,;:—–-]+/u, "");
  let m: RegExpExecArray | null = null;
  if (backward) {
    for (const x of seg.matchAll(new RegExp(INQUIT_SRC, "giu"))) m = x;
  } else {
    m = new RegExp(INQUIT_SRC, "iu").exec(seg.slice(0, window));
  }
  if (!m) return null;
  const got = subject(seg.slice(m.index + m[0].length), true) ?? subject(seg.slice(0, m.index), false);
  return got ? { surface: got.surface, kind: got.kind, verb: m[0].toLowerCase() } : null;
}

// --------------------------------------------------------------------------- //
// Figurenverwaltung
// --------------------------------------------------------------------------- //
export class Cast {
  readonly byId = new Map<string, CastMember>();
  readonly alias = new Map<string, string>();
  readonly remap = new Map<string, string>();

  constructor(preset: CastPreset[] = []) {
    for (const c of preset) {
      const id = c.id || slug(c.name);
      this.byId.set(id, {
        id, name: c.name, aliases: [...(c.aliases ?? [])], gender: c.gender ?? "?",
        color: c.color ?? null, badge: c.badge ?? "", note: c.note ?? "", pinned: true,
        lines: 0, words: 0, chapters: [], first: null, kind: c.kind ?? "name",
      });
    }
    // Eigennamen zuerst, danach Aliasse: ein gepflegter Alias sticht den
    // gleichlautenden Namen eines anderen Eintrags, der dann verschwindet.
    for (const [id, c] of this.byId) this.alias.set(c.name.toLowerCase(), id);
    for (const [id, c] of [...this.byId]) {
      for (const a of c.aliases) {
        const key = a.toLowerCase().trim();
        const dup = this.alias.get(key);
        if (dup && dup !== id && this.byId.get(dup)?.name.toLowerCase() === key) {
          for (const [k, v] of this.alias) if (v === dup) this.alias.set(k, id);
          this.byId.delete(dup);
        }
        this.alias.set(key, id);
      }
    }
  }

  resolve(surface: string, kind: SubjectKind): string {
    const key = stripChars(surface.toLowerCase(), " .,;:");
    const known = this.alias.get(key);
    if (known) return known;
    const id = slug(surface);
    if (!this.byId.has(id)) {
      this.byId.set(id, {
        id, name: surface, aliases: [], gender: "?", color: null, badge: "", note: "",
        pinned: false, lines: 0, words: 0, chapters: [], first: null, kind,
      });
    }
    this.alias.set(key, id);
    return id;
  }

  /**
   * »Captain Hamilton« und »Hamilton« zusammenführen – nur wenn die titelfreien
   * Namensteile identisch sind und sich die Anreden nicht widersprechen
   * (»Miß Tibbetts« und »Leutnant Tibbetts« bleiben getrennt).
   */
  mergeSimilar(): void {
    const parts = (c: CastMember) => {
      const t = new Set(splitWs(c.name).filter((x) => x.length >= 2)
        .map((x) => stripChars(x, ".").toLowerCase()));
      return {
        titles: new Set([...t].filter((x) => TITLE_WORDS.has(x))),
        core: new Set([...t].filter((x) => !TITLE_WORDS.has(x))),
      };
    };
    const same = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));
    const items = [...this.byId.values()].sort((a, b) => b.lines - a.lines);
    for (const small of items) {
      if (small.pinned || !this.byId.has(small.id)) continue;
      const ps = parts(small);
      if (!ps.core.size) continue;
      for (const big of items) {
        if (big === small || !this.byId.has(big.id)) continue;
        const pb = parts(big);
        if (!same(pb.core, ps.core) || big.lines < small.lines) continue;
        if (ps.titles.size && pb.titles.size && !same(ps.titles, pb.titles)) continue;
        this.absorb(big, small);
        break;
      }
    }
  }

  private absorb(keep: CastMember, drop: CastMember): void {
    if (!this.byId.has(drop.id)) return;
    keep.lines += drop.lines;
    keep.words += drop.words;
    keep.aliases = [...new Set([...keep.aliases, drop.name, ...drop.aliases])].sort(cmpStr);
    keep.chapters = [...new Set([...keep.chapters, ...drop.chapters])].sort(cmpStr);
    for (const [k, v] of this.alias) if (v === drop.id) this.alias.set(k, keep.id);
    this.byId.delete(drop.id);
    this.remap.set(drop.id, keep.id);
  }
}

function guessGender(cast: Cast, fullText: string): void {
  for (const c of cast.byId.values()) {
    if (c.gender !== "?") continue;
    const toks = new Set(c.name.toLowerCase().match(new RegExp(`[${W}äöüß]+`, "gu")) ?? []);
    if ([...toks].some((t) => TITLES_F.has(t))) {
      c.gender = "f";
      continue;
    }
    if ([...toks].some((t) => TITLES_M.has(t))) {
      c.gender = "m";
      continue;
    }
    if (c.kind !== "name") continue;
    // Ko-Text-Statistik: NAME … er/ihn/sein  vs.  NAME … sie/ihr
    const pat = new RegExp(`${B}${escapeRe(c.name)}${B}[^.!?»«„“]{0,70}?${B}`
      + `(er|ihn|ihm|seine?[nmrs]?|he|his|him|sie|ihre?[nmrs]?|she|her)${B}`, "giu");
    let m = 0;
    let f = 0;
    for (const mo of fullText.matchAll(pat)) {
      const w = mo[1]!.toLowerCase();
      if (["er", "ihn", "ihm", "sein", "he", "his", "him"].some((p) => w.startsWith(p))) m++;
      else f++;
    }
    if (m + f >= 3) c.gender = m > f * 1.4 ? "m" : f > m * 1.4 ? "f" : "?";
  }
}

function distinct(seq: string[]): string[] {
  const out: string[] = [];
  for (let i = seq.length - 1; i >= 0; i--) if (!out.includes(seq[i]!)) out.push(seq[i]!);
  return out;
}

/** Wer in der Replik angeredet wird (»M'anin, warum …«), spricht sie nicht. */
function notAddressed(cand: string[], cast: Cast, utt: string): string[] {
  const keep = cand.filter((id) => {
    const c = cast.byId.get(id);
    const core = c ? (splitWs(c.name).at(-1) ?? "") : "";
    return !(core.length >= 3 && new RegExp(`${B}${escapeRe(core)}${B}`, "u").test(utt));
  });
  return keep.length ? keep : cand;
}

function pickPron(cand: string[], cast: Cast, want: string): string | null {
  if (want === "1") return cast.resolve("Ich-Erzähler", "name");
  const order = cand.length >= 2 ? [...cand.slice(1), ...cand.slice(0, 1)] : cand;
  if (want === "m" || want === "f") {
    for (const id of order) if (cast.byId.get(id)?.gender === want) return id;
  }
  return order[0] ?? null;
}

function stats(doc: Doc, cast: Cast): void {
  for (const c of cast.byId.values()) {
    c.lines = 0;
    c.words = 0;
    c.chapters = [];
  }
  for (const ch of doc.chapters) {
    for (const b of ch.blocks) {
      for (const sp of b.speech ?? []) {
        const c = sp.speaker ? cast.byId.get(sp.speaker) : undefined;
        if (!c) continue;
        c.lines++;
        c.words += wordCount(b.text.slice(sp.s, sp.e));
        if (!c.chapters.includes(ch.id)) c.chapters.push(ch.id);
        c.first ??= ch.id;
      }
    }
  }
}

// --------------------------------------------------------------------------- //
// Hauptlauf
// --------------------------------------------------------------------------- //
export function attributeSpeakers(doc: Doc, preset: CastPreset[] = []): Doc {
  const cast = new Cast(preset);
  const fullText = doc.chapters.flatMap((c) => c.blocks.map((b) => b.text)).join("\n");

  // ---- Durchgang 1: explizite Zuordnungen ------------------------------- //
  for (const ch of doc.chapters) {
    for (const b of ch.blocks) {
      const sents = b.sent?.length ? b.sent : [[0, b.text.length] as [number, number]];
      for (const sp of b.speech ?? []) {
        if (sp.inner) {
          Object.assign(sp, { speaker: null, conf: 0, via: "inner" });
          continue;
        }
        const s0 = sp.s;
        const sent = sents.find(([a, z]) => a <= s0 && s0 < z) ?? [0, b.text.length];
        const prefix = b.text.slice(sent[0], s0);
        const suffix = b.text.slice(sp.e, sent[1]);

        let hit: InquitHit | null = inquit(suffix);
        let via = hit ? "inquit_after" : null;
        if (!hit) {
          hit = inquit(prefix.slice(-140));
          if (hit) via = "inquit_before";
        }
        // Kein Hinweis im selben Satz: im Absatz rückwärts suchen
        sp._back = hit ? null : inquit(b.text.slice(Math.max(0, s0 - 220), s0), 90, true);

        if (hit && hit.kind === "pron") {
          Object.assign(sp, { speaker: null, conf: 0, via: `${via}_pron`, _pron: hit.surface,
            _resp: RESPONSE_VERBS.has(hit.verb) });
        } else if (hit) {
          const id = cast.resolve(hit.surface, hit.kind);
          let conf = hit.kind === "name" ? 0.95 : 0.75;
          if (via === "inquit_before") conf -= 0.05;
          Object.assign(sp, { speaker: id, conf, via });
        } else {
          Object.assign(sp, { speaker: null, conf: 0, via: null });
        }
      }
    }
  }

  stats(doc, cast);
  guessGender(cast, fullText);

  // ---- Durchgang 2: Pronomen, Absatz, Nähe, Wechselrede ----------------- //
  for (const ch of doc.chapters) {
    const recent: string[] = [];
    let narrNames: string[] | null = null; // nur direkt nach Erzähltext gültig
    for (const b of ch.blocks) {
      const speeches = (b.speech ?? []).filter((sp) => !sp.inner);
      const paragraphMate = (): string | null => {
        const s = new Set(speeches.filter((x) => x.speaker && (x.conf ?? 0) >= 0.55).map((x) => x.speaker!));
        return s.size === 1 ? [...s][0]! : null;
      };
      const assign = (sp: SpeechSpan, speaker: string, conf: number, via: string) => {
        Object.assign(sp, { speaker, conf, via });
        recent.push(speaker);
        narrNames = null;
      };

      for (const sp of speeches) {
        if (sp.speaker) {
          recent.push(sp.speaker);
          narrNames = null;
          continue;
        }
        if (sp.cont && recent.length) {
          Object.assign(sp, { speaker: recent.at(-1)!, conf: 0.7, via: "continuation" });
          continue;
        }
        const utt = b.text.slice(sp.s, sp.e);
        const { _pron: pron, _resp: resp, _back: back } = sp;
        delete sp._pron;
        delete sp._resp;
        delete sp._back;
        const cand = notAddressed(distinct(recent), cast, utt);

        if (pron && resp) {
          const pick = pickPron(cand, cast, PRONOUNS[pron.toLowerCase()] ?? "?");
          if (pick) {
            assign(sp, pick, 0.6, "pronoun");
            continue;
          }
        }
        const mate = paragraphMate();
        if (mate) {
          assign(sp, mate, 0.7, "same_paragraph");
          continue;
        }
        if (pron) {
          const pick = pickPron(cand, cast, PRONOUNS[pron.toLowerCase()] ?? "?");
          if (pick) {
            assign(sp, pick, 0.55, "pronoun");
            continue;
          }
        }
        if (back && back.kind !== "pron") {
          assign(sp, cast.resolve(back.surface, back.kind), 0.5, "inquit_paragraph");
          continue;
        }
        if (narrNames) {
          const known = new Set<string>();
          for (const n of narrNames as string[]) {
            const id = cast.alias.get(n.toLowerCase());
            if (id) known.add(id);
          }
          const k = new Set(notAddressed([...known], cast, utt));
          if (k.size === 1) {
            assign(sp, [...k][0]!, 0.45, "proximity");
            continue;
          }
        }
        if (cand.length >= 2) assign(sp, cand[1]!, 0.4, "alternation");
        else if (cand.length === 1) assign(sp, cand[0]!, 0.35, "alternation");
        else Object.assign(sp, { speaker: null, conf: 0, via: "unknown" });
        narrNames = null;
      }
      if (speeches.length) narrNames = null;
      else if (b.type === "p") narrNames = b.text.match(RE_NAME_ALL) ?? [];
    }
    for (const b of ch.blocks) {
      for (const sp of b.speech ?? []) {
        delete sp._pron;
        delete sp._resp;
        delete sp._back;
      }
    }
  }

  cast.mergeSimilar();
  if (cast.remap.size) {
    for (const ch of doc.chapters) {
      for (const b of ch.blocks) {
        for (const sp of b.speech ?? []) {
          const to = sp.speaker ? cast.remap.get(sp.speaker) : undefined;
          if (to) sp.speaker = to;
        }
      }
    }
  }
  stats(doc, cast);

  doc.cast = [...cast.byId.values()].sort((a, b) => b.lines - a.lines || cmpStr(a.name, b.name));
  return doc;
}
