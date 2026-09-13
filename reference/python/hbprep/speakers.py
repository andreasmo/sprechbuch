# -*- coding: utf-8 -*-
"""Sprecherzuordnung für direkte Rede (DE/EN), regelbasiert.

Strategie, in dieser Reihenfolge:
  1. Inquit *nach* der Rede    »…«, sagte Makara            conf 0.95
  2. Inquit *vor* der Rede     Makara sagte: »…«            conf 0.90
  3. Beschreibende Nominalphrase  »…«, erwiderte der Häuptling  conf 0.75
  4. Pronominales Inquit       »…«, sagte er   -> Auflösung  conf 0.55
  5. Nähe: Absatz davor nennt genau eine bekannte Figur      conf 0.45
  6. Alternation in einer Zwei-Personen-Szene                conf 0.40
  7. Fortsetzung eines mehrteiligen Redeblocks               erbt Sprecher
Alles darunter bleibt unattribuiert und wird im Report gelistet.
"""

from __future__ import annotations

import re
import unicodedata

# --------------------------------------------------------------------------- #
# Lexika
# --------------------------------------------------------------------------- #
VERBS_DE = """
sagte sagt sagten spricht sprach sprachen rief ruft riefen fragte fragt fragten
antwortete antwortet erwiderte erwidert entgegnete entgegnet meinte meint
flüsterte flüstert wisperte raunte tuschelte murmelte murmelt brummte brummelte
knurrte grollte murrte maulte seufzte stöhnte ächzte keuchte schnaubte prustete
lachte kicherte grinste schrie schrie brüllte kreischte zischte fauchte hauchte
stammelte stotterte plapperte erklärte erklärt erläuterte versicherte beteuerte
behauptete bemerkte ergänzte fügte setzte wiederholte begann beginnt fuhr
unterbrach befahl gebot mahnte warnte drohte spottete höhnte witzelte scherzte
jammerte klagte wimmerte schluchzte gestand stimmte nickte widersprach
protestierte beharrte drängte bat flehte forderte verlangte wandte versetzte
begrüßte verabschiedete dachte denkt überlegte staunte wunderte log erzählte
berichtete verkündete betonte bestätigte erinnerte tröstete brüllt lispelte
schmunzelte kommentierte antwortete_ frohlockte japste stieß
"""
VERBS_EN = """
said says replied replies answered answers asked asks cried cries shouted
whispered murmured muttered growled snapped exclaimed added continued began
remarked observed noted sighed laughed chuckled gasped breathed hissed groaned
moaned stammered insisted agreed protested admitted confessed declared announced
explained urged warned ordered commanded offered thought mused ventured echoed
repeated called yelled screamed wondered demanded interrupted put went
"""
VERBS = sorted({w for w in (VERBS_DE + VERBS_EN).split() if w and not w.endswith("_")},
               key=len, reverse=True)
RE_INQUIT = re.compile(r"\b(?:%s)\b" % "|".join(map(re.escape, VERBS)), re.I)

PRONOUNS = {
    "er": "m", "he": "m", "ihn": "m", "ihm": "m",
    "sie": "f", "she": "f", "ihr": "f",
    "es": "n", "it": "n",
    "ich": "1", "i": "1",
    "man": "?", "wir": "?", "we": "?", "they": "?", "du": "?", "you": "?",
}
ART = (r"(?:[Dd]er|[Dd]ie|[Dd]as|[Dd]en|[Dd]em|[Ee]in|[Ee]ine|[Ee]inen|[Ee]inem|"
       r"[Ee]iner|[Ss]ein|[Ss]eine[nmr]?|[Ii]hr|[Ii]hre[nmr]?|[Tt]he|[Aa]|[Aa]n|"
       r"[Hh]is|[Hh]er|[Mm]y)")
TITLE = (r"(?:Herr|Frau|Fräulein|Frl|Miß|Miss|Mrs|Mr|Ms|Dr|Prof|Professor|Sir|Lady|"
         r"Lord|König|Königin|Prinz|Prinzessin|Graf|Gräfin|Häuptling|Hauptmann|"
         r"Kapitän|Captain|Leutnant|Lieutenant|Major|Colonel|Oberst|Sergeant|Onkel|"
         r"Tante|Vater|Mutter|Bruder|Schwester|Doktor|Pater|General|Admiral)\.?")
CAP = r"[A-ZÄÖÜ][\wÄÖÜäöüß'’\-]+"
# Ein Name: optionaler Titel, Kernname, optionales Adelsprädikat, ein Zusatzwort.
NAME = r"(?:%s\s+)?%s(?:\s+(?:von|van|de|della|ibn)\s+%s)?(?:\s+%s)?" % (TITLE, CAP, CAP, CAP)
# Beschreibende Nominalphrase: Artikel + Adjektive + *großgeschriebenes* Nomen.
# (Im Deutschen ist der Kopf einer NP immer großgeschrieben – das filtert
#  Adverbien wie »der andere stolz« zuverlässig heraus.)
NP = r"%s\s+(?:[a-zäöüß]{2,}\s+){0,2}%s" % (ART, CAP)
NOUN = r"[a-zäöüß][\wäöüß\-]{2,}"
ADV = r"(?:\s+(?:dann|nun|noch|schon|leise|laut|ruhig|plötzlich|nur|auch|jetzt|" \
      r"wieder|endlich|kurz|langsam|hastig|then|now|softly|quietly|suddenly))?"

RE_SUBJ_HEAD = [
    ("pron", re.compile(r"^\s*(?:%s)?\s*(er|sie|es|ich|man|du|wir|he|she|i|they|we|you)\b" % ADV, re.I)),
    ("np", re.compile(r"^\s*(?:%s)?\s*(%s)" % (ADV, NP))),
    ("name", re.compile(r"^\s*(?:%s)?\s*(%s)" % (ADV, NAME))),
]
RE_SUBJ_TAIL = [
    ("np", re.compile(r"(%s)\s*$" % NP)),
    ("name", re.compile(r"(%s)\s*$" % NAME)),
    ("pron", re.compile(r"\b(er|sie|es|ich|man|du|wir|he|she|i|they|we|you)\s*$", re.I)),
]
RE_NAME_ONLY = re.compile(NAME)

TITLE_WORDS = {t.strip(".").lower() for t in
               re.findall(r"[A-Za-zÄÖÜäöüß]+", TITLE)}
TITLES_M = {"herr", "hr", "mr", "mister", "sir", "lord", "könig", "prinz", "graf",
            "vater", "bruder", "sohn", "onkel", "opa", "großvater", "häuptling",
            "hauptmann", "kapitän", "leutnant", "doktor", "pfarrer", "junge", "mann",
            "bursche", "alte", "fremde", "wirt", "bauer", "knecht", "diener"}
TITLES_F = {"frau", "fr", "mrs", "miss", "ms", "lady", "königin", "prinzessin",
            "gräfin", "mutter", "schwester", "tochter", "tante", "oma", "großmutter",
            "mädchen", "dame", "wirtin", "magd", "dienerin", "alte"}
# Großgeschriebene Satzanfänge, die nie ein Sprechername sind.
STOP_NAMES = set("""
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
the a an his her their our my your what when where why how because although
""".split())


def slug(s: str) -> str:
    s = unicodedata.normalize("NFKD", s.lower())
    s = s.replace("ß", "ss")
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s or "x"


def _clean_np(t: str) -> str:
    t = re.sub(r"^\s*(?:%s)\s+" % ART, "", t.strip())
    t = re.sub(r"\s+", " ", t).strip(" ,.;:!?–—-")
    return t


def _subject(seg: str, head: bool) -> tuple[str, str] | None:
    """(Oberfläche, Typ) des Subjekts am Anfang (head=True) bzw. Ende des Segments."""
    for kind, rx in (RE_SUBJ_HEAD if head else RE_SUBJ_TAIL):
        m = rx.search(seg)
        if not m:
            continue
        surface = m.group(1).strip()
        if kind == "pron":
            return surface.lower(), "pron"
        if kind == "name":
            if surface.lower() in PRONOUNS:            # »Sie«, »Er« am Satzanfang
                return surface.lower(), "pron"
            first = surface.split()[0].lower().strip(".,;:")
            if first in STOP_NAMES or len(surface) < 3:
                continue
            return surface.strip(" ,.;:"), "name"
        np = _clean_np(surface)
        if np.split()[0].lower() in STOP_NAMES and len(np.split()) == 1:
            continue
        return np, "np"
    return None


# Verben, die eine *Antwort* einleiten: hier meint »sagte er« den jeweils
# anderen Gesprächspartner, nicht den Sprecher des vorigen Satzes im Absatz.
RESPONSE_VERBS = {"erwiderte", "erwidert", "entgegnete", "entgegnet", "antwortete",
                  "antwortet", "versetzte", "widersprach", "protestierte",
                  "replied", "answered", "retorted", "objected", "protested"}


def _inquit(seg: str, window: int = 90, backward: bool = False):
    """Sucht eine Redeeinleitung; liefert (Oberfläche, Typ, Verb) oder None."""
    seg = seg.strip()
    if not seg:
        return None
    seg = re.sub(r"^[\s,;:—–-]+", "", seg)
    if backward:
        ms = list(RE_INQUIT.finditer(seg))
        m = ms[-1] if ms else None
    else:
        m = RE_INQUIT.search(seg[:window])
    if not m:
        return None
    got = _subject(seg[m.end():], head=True) or _subject(seg[:m.start()], head=False)
    if not got:
        return None
    return got[0], got[1], m.group().lower()


# --------------------------------------------------------------------------- #
# Hauptlauf
# --------------------------------------------------------------------------- #
class Cast:
    def __init__(self, preset: list[dict] | None = None):
        self.by_id: dict[str, dict] = {}
        self.alias: dict[str, str] = {}
        for c in preset or []:
            cid = c.get("id") or slug(c["name"])
            self.by_id[cid] = {
                "id": cid, "name": c["name"], "aliases": list(c.get("aliases", [])),
                "gender": c.get("gender", "?"), "color": c.get("color"),
                "badge": c.get("badge") or "",
                "note": c.get("note", ""), "pinned": True,
                "lines": 0, "words": 0, "chapters": [], "first": None, "kind": c.get("kind", "name"),
            }
        # Eigennamen zuerst, danach die Aliasse: ein ausdrücklich gepflegter
        # Alias sticht den gleichlautenden Namen eines anderen Eintrags. Der
        # überflüssige Eintrag verschwindet – so genügt es, in cast.json den
        # Alias zu ergänzen, ohne die alte Figur von Hand zu löschen.
        for cid, c in self.by_id.items():
            self.alias[c["name"].lower()] = cid
        for cid, c in list(self.by_id.items()):
            for a in c["aliases"]:
                key = a.lower().strip()
                dup = self.alias.get(key)
                if dup and dup != cid and self.by_id.get(dup, {}).get("name", "").lower() == key:
                    for k, v in list(self.alias.items()):
                        if v == dup:
                            self.alias[k] = cid
                    self.by_id.pop(dup, None)
                self.alias[key] = cid

    def resolve(self, surface: str, kind: str) -> str:
        key = surface.lower().strip(" .,;:")
        if key in self.alias:
            return self.alias[key]
        cid = slug(surface)
        if cid not in self.by_id:
            self.by_id[cid] = {"id": cid, "name": surface, "aliases": [], "gender": "?",
                               "color": None, "note": "", "pinned": False, "lines": 0,
                               "words": 0, "chapters": [], "first": None, "kind": kind}
        self.alias[key] = cid
        return cid

    def merge_similar(self) -> None:
        """»Captain Hamilton« und »Hamilton« zusammenführen.

        Nur wenn die *unterscheidenden* (titelfreien) Namensteile identisch sind
        und die Titel sich nicht widersprechen – »Miß Tibbetts« und
        »Leutnant Tibbetts« bleiben deshalb zwei Figuren.
        """
        def parts(c):
            t = {x.strip(".").lower() for x in c["name"].split() if len(x) >= 2}
            return t & TITLE_WORDS, t - TITLE_WORDS

        items = sorted(self.by_id.values(), key=lambda c: -c["lines"])
        for small in list(items):
            if small["pinned"] or small["id"] not in self.by_id:
                continue
            ts, ds = parts(small)
            if not ds:
                continue
            for big in items:
                if big is small or big["id"] not in self.by_id:
                    continue
                tb, db = parts(big)
                if db != ds or big["lines"] < small["lines"]:
                    continue
                if ts and tb and ts != tb:          # widersprüchliche Anreden
                    continue
                self._absorb(big, small)
                break

    def _absorb(self, keep: dict, drop: dict) -> None:
        if drop["id"] not in self.by_id:
            return
        keep["lines"] += drop["lines"]
        keep["words"] += drop["words"]
        keep["aliases"] = sorted(set(keep["aliases"] + [drop["name"]] + drop["aliases"]))
        keep["chapters"] = sorted(set(keep["chapters"] + drop["chapters"]))
        for k, v in list(self.alias.items()):
            if v == drop["id"]:
                self.alias[k] = keep["id"]
        del self.by_id[drop["id"]]
        self._remap = getattr(self, "_remap", {})
        self._remap[drop["id"]] = keep["id"]


def _guess_gender(cast: Cast, full_text: str) -> None:
    for c in cast.by_id.values():
        if c["gender"] != "?":
            continue
        low = c["name"].lower()
        toks = set(re.findall(r"[\wäöüß]+", low))
        if toks & TITLES_F:
            c["gender"] = "f"
            continue
        if toks & TITLES_M:
            c["gender"] = "m"
            continue
        if c["kind"] != "name":
            continue
        # Ko-Text-Statistik: NAME … er/ihn/sein  vs.  NAME … sie/ihr
        pat = re.compile(r"\b%s\b[^.!?»«„“]{0,70}?\b(er|ihn|ihm|seine?[nmrs]?|he|his|him|"
                         r"sie|ihre?[nmrs]?|she|her)\b" % re.escape(c["name"]), re.I)
        m_, f_ = 0, 0
        for mo in pat.finditer(full_text):
            w = mo.group(1).lower()
            if w.startswith(("er", "ihn", "ihm", "sein", "he", "his", "him")):
                m_ += 1
            else:
                f_ += 1
        if m_ + f_ >= 3:
            c["gender"] = "m" if m_ > f_ * 1.4 else ("f" if f_ > m_ * 1.4 else "?")


def attribute(doc: dict, preset_cast: list[dict] | None = None,
              overrides: dict | None = None) -> dict:
    cast = Cast(preset_cast)
    overrides = overrides or {}
    full_text = "\n".join(b["text"] for ch in doc["chapters"] for b in ch["blocks"])

    # ---- Durchgang 1: explizite Zuordnungen ------------------------------ #
    for ch in doc["chapters"]:
        recent: list[str] = []
        for b in ch["blocks"]:
            sents = b.get("sent") or [[0, len(b["text"])]]
            for sp in b.get("speech", []):
                if sp.get("inner"):
                    sp.update(speaker=None, conf=0.0, via="inner")
                    continue
                s0, e0 = sp["s"], sp["e"]
                sent = next((x for x in sents if x[0] <= s0 < x[1]), [0, len(b["text"])])
                prefix = b["text"][sent[0]:s0]
                suffix = b["text"][e0:sent[1]]

                hit, via = None, None
                got = _inquit(suffix)
                if got:
                    hit, via = got, "inquit_after"
                if not hit:
                    got = _inquit(prefix[-140:])
                    if got:
                        hit, via = got, "inquit_before"

                # Kein Hinweis im selben Satz: im Absatz rückwärts suchen
                # (»Bevor Sanders antwortete, … . »Hast du …«)
                back = None
                if not hit:
                    back = _inquit(b["text"][max(0, s0 - 220):s0], backward=True)

                sp["_back"] = back
                if hit and hit[1] == "pron":
                    sp.update(speaker=None, conf=0.0, via=via + "_pron",
                              _pron=hit[0], _resp=hit[2] in RESPONSE_VERBS)
                elif hit:
                    surface, kind, _verb = hit
                    cid = cast.resolve(surface, kind)
                    conf = 0.95 if kind == "name" else 0.75
                    if via == "inquit_before":
                        conf -= 0.05
                    sp.update(speaker=cid, conf=conf, via=via)
                    recent.append(cid)
                else:
                    sp.update(speaker=None, conf=0.0, via=None)

    _stats(doc, cast)
    _guess_gender(cast, full_text)

    # ---- Durchgang 2: Pronomen, Nähe, Alternation ------------------------ #
    for ch in doc["chapters"]:
        recent: list[str] = []
        narr_names: list[str] | None = None      # nur direkt nach Erzähltext gültig
        for b in ch["blocks"]:
            speeches = [sp for sp in b.get("speech", []) if not sp.get("inner")]
            def paragraph_mate():
                """Mehrere Redeteile in einem Absatz gehören fast immer
                derselben Figur – solange der Absatz nur einen belegten
                Sprecher hat."""
                s = {x["speaker"] for x in speeches
                     if x.get("speaker") and x.get("conf", 0) >= 0.55}
                return s.pop() if len(s) == 1 else None

            for sp in speeches:
                if sp.get("speaker"):
                    recent.append(sp["speaker"])
                    narr_names = None
                    continue
                if sp.get("cont") and recent:
                    sp.update(speaker=recent[-1], conf=0.7, via="continuation")
                    continue
                utt = b["text"][sp["s"]:sp["e"]]
                pron = sp.pop("_pron", None)
                resp = sp.pop("_resp", False)
                back = sp.pop("_back", None)
                cand = _not_addressed(_distinct(recent), cast, utt)
                # Antwortverb (»erwiderte er«) meint den Gesprächspartner
                if pron and resp:
                    pick = _pick_pron(cand, cast, PRONOUNS.get(pron.lower(), "?"))
                    if pick:
                        sp.update(speaker=pick, conf=0.6, via="pronoun")
                        recent.append(pick)
                        narr_names = None
                        continue
                mate = paragraph_mate()
                if mate:
                    sp.update(speaker=mate, conf=0.7, via="same_paragraph")
                    recent.append(mate)
                    narr_names = None
                    continue
                if pron:
                    pick = _pick_pron(cand, cast, PRONOUNS.get(pron.lower(), "?"))
                    if pick:
                        sp.update(speaker=pick, conf=0.55, via="pronoun")
                        recent.append(pick)
                        narr_names = None
                        continue
                if back and back[1] != "pron":
                    cid = cast.resolve(back[0], back[1])
                    sp.update(speaker=cid, conf=0.5, via="inquit_paragraph")
                    recent.append(cid)
                    narr_names = None
                    continue
                # Nähe: der Erzählabsatz unmittelbar davor nennt genau eine Figur
                if narr_names:
                    known = {cast.alias[n.lower()] for n in narr_names
                             if n.lower() in cast.alias}
                    known = set(_not_addressed(list(known), cast, utt))
                    if len(known) == 1:
                        cid = known.pop()
                        sp.update(speaker=cid, conf=0.45, via="proximity")
                        recent.append(cid)
                        narr_names = None
                        continue
                if len(cand) >= 2:
                    sp.update(speaker=cand[1], conf=0.4, via="alternation")
                    recent.append(cand[1])
                elif len(cand) == 1:
                    sp.update(speaker=cand[0], conf=0.35, via="alternation")
                    recent.append(cand[0])
                else:
                    sp.update(speaker=None, conf=0.0, via="unknown")
                narr_names = None
            if speeches:
                narr_names = None
            elif b["type"] == "p":
                narr_names = RE_NAME_ONLY.findall(b["text"])
        for b in ch["blocks"]:
            for sp in b.get("speech", []):
                for k in ("_recent", "_prev_names", "_pron", "_resp", "_back"):
                    sp.pop(k, None)

    # ---- Overrides (Sprecher-Korrekturen) -------------------------------- #
    if overrides:
        _apply_overrides(doc, cast, overrides)

    cast.merge_similar()
    remap = getattr(cast, "_remap", {})
    if remap:
        for ch in doc["chapters"]:
            for b in ch["blocks"]:
                for sp in b.get("speech", []):
                    if sp.get("speaker") in remap:
                        sp["speaker"] = remap[sp["speaker"]]
    _stats(doc, cast)

    doc["cast"] = sorted(cast.by_id.values(), key=lambda c: (-c["lines"], c["name"]))
    return doc


def _distinct(seq: list[str]) -> list[str]:
    out = []
    for x in reversed(seq):
        if x not in out:
            out.append(x)
    return out


def _not_addressed(cand: list[str], cast: Cast, utt: str) -> list[str]:
    """Wer in der Replik angeredet wird (»M'anin, warum …«), spricht sie nicht."""
    keep = []
    for cid in cand:
        c = cast.by_id.get(cid)
        core = c["name"].split()[-1] if c else ""
        if core and len(core) >= 3 and re.search(r"\b%s\b" % re.escape(core), utt):
            continue
        keep.append(cid)
    return keep or cand


def _pick_pron(cand: list[str], cast: Cast, want: str) -> str | None:
    if want == "1":
        return cast.resolve("Ich-Erzähler", "name")
    order = cand[1:] + cand[:1] if len(cand) >= 2 else cand   # Alternation bevorzugen
    if want in ("m", "f"):
        for cid in order:
            if cast.by_id.get(cid, {}).get("gender") == want:
                return cid
    return order[0] if order else None


def _apply_overrides(doc: dict, cast: Cast, ov: dict) -> None:
    """ov: {"ch002:17": "sanders"} – Kapitel-ID : laufende Satznummer -> Cast-ID."""
    for ch in doc["chapters"]:
        for b in ch["blocks"]:
            sents = b.get("sent") or []
            sids = b.get("sid") or []
            for sp in b.get("speech", []):
                for (a, z), sid in zip(sents, sids):
                    if a <= sp["s"] < z:
                        key = "%s:%d" % (ch["id"], sid)
                        if key in ov:
                            target = ov[key]
                            cid = cast.alias.get(target.lower(), target)
                            if cid not in cast.by_id:
                                cid = cast.resolve(target, "name")
                            sp.update(speaker=cid, conf=1.0, via="override")
                        break


def _stats(doc: dict, cast: Cast) -> None:
    for c in cast.by_id.values():
        c["lines"] = c["words"] = 0
        c["chapters"] = []
    for ch in doc["chapters"]:
        for b in ch["blocks"]:
            for sp in b.get("speech", []):
                cid = sp.get("speaker")
                if not cid or cid not in cast.by_id:
                    continue
                c = cast.by_id[cid]
                c["lines"] += 1
                c["words"] += len(re.findall(r"[^\W\d_]+", b["text"][sp["s"]:sp["e"]]))
                if ch["id"] not in c["chapters"]:
                    c["chapters"].append(ch["id"])
                if c["first"] is None:
                    c["first"] = ch["id"]
