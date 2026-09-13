# -*- coding: utf-8 -*-
"""Satzsegmentierung (DE/EN), regelbasiert, ohne Fremdbibliotheken.

Kernproblem beim Hörbuch-Skript: der Satz ist die Einheit, die der Sprecher
atmet.  Die Segmentierung muss deshalb vor allem *keine* falschen Grenzen
setzen – bei »…«, sagte er.  ist das ein Satz, nicht zwei.
"""

from __future__ import annotations

import re

# Abkürzungen, nach denen ein Punkt keine Satzgrenze ist.
ABBREV = {
    # deutsch
    "z", "b", "zb", "dh", "ua", "ggf", "bzw", "ca", "evtl", "usw", "usf", "vgl",
    "bspw", "inkl", "exkl", "max", "min", "mind", "sog", "u", "a", "d", "h",
    "nr", "abb", "tab", "kap", "bd", "jh", "jhd", "chr", "geb", "gest", "verst",
    "ebd", "ff", "f", "s", "str", "pl", "hrsg", "aufl", "od", "bzgl", "etc",
    "dr", "prof", "dipl", "ing", "med", "phil", "jur", "rer", "nat", "hc",
    "hr", "fr", "frl", "mr", "mrs", "ms", "st", "hl", "kl", "gr", "nachm",
    "vorm", "mio", "mrd", "tsd", "gez", "i", "v", "m", "e", "o", "n", "z.b",
    # englisch
    "mt", "jr", "sr", "vs", "eg", "ie", "approx", "dept", "univ", "co", "inc",
    "ltd", "cf", "al", "ed", "vol", "pp", "fig", "no", "esp",
}
MONTHS = {
    "januar", "februar", "märz", "april", "mai", "juni", "juli", "august",
    "september", "oktober", "november", "dezember", "jänner",
    "january", "february", "march", "may", "june", "july", "october", "december",
}

OPENERS = "«»„“”‘’‚‹›\"'([{–—-"
CLOSERS = "«»“”‘’‹›\"')]}"

_END = re.compile(r"[.!?…]+")
_UPPER = re.compile(r"[A-ZÄÖÜÁÀÂÉÈÊÍÎÓÔÚÛÑÇŠŽŁ0-9]")
_WORD = re.compile(r"[^\W\d_]+", re.UNICODE)


def _prev_token(text: str, i: int) -> str:
    j = i
    while j > 0 and (text[j - 1].isalnum() or text[j - 1] in "ÄÖÜäöüß."):
        j -= 1
    return text[j:i]


def sentence_spans(text: str) -> list[tuple[int, int]]:
    """Liefert (start, ende)-Offsets aller Sätze eines Blocks."""
    spans, start, n = [], 0, len(text)
    for m in _END.finditer(text):
        i, j = m.start(), m.end()
        punct = m.group()

        # Trailing Anführungs-/Klammerzeichen mit einschließen
        k = j
        while k < n and text[k] in CLOSERS:
            k += 1

        rest = text[k:]
        nxt = rest.lstrip()
        # Satzende nur, wenn danach Ende oder Großbuchstabe/Anführung/Gedankenstrich
        if nxt and not (_UPPER.match(nxt[0]) or nxt[0] in OPENERS):
            continue
        if nxt and rest and not rest[0].isspace() and k < n:
            # z.B. "Wort.Wort" – meist Fehler in der Quelle, trotzdem trennen,
            # aber nicht mitten in Ziffern (3.14) oder Domains
            if text[i - 1:i].isdigit() and nxt[0].isdigit():
                continue

        if punct == ".":
            tok = _prev_token(text, i).strip(".").lower()
            if tok in ABBREV and len(tok) <= 5:
                continue
            if len(tok) == 1 and tok.isalpha():          # Initialen: J. R. R.
                continue
            if tok.isdigit():                            # Ordinalzahl / Datum
                w = _WORD.search(nxt or "")
                if not nxt:
                    pass
                elif nxt[0].islower() or (w and w.group().lower() in MONTHS):
                    continue
                elif len(tok) <= 2 and int(tok) <= 31:   # "am 3. Oktober", "1. Kapitel"
                    continue

        if punct.startswith("…") or punct == "...":
            if not nxt or (nxt and not (_UPPER.match(nxt[0]) or nxt[0] in "»„“\"")):
                continue

        end = k
        if text[start:end].strip():
            spans.append((start, end))
        start = k
        while start < n and text[start].isspace():
            start += 1

    if start < n and text[start:].strip():
        spans.append((start, n))
    return spans


def word_count(text: str) -> int:
    return len(_WORD.findall(text))


def segment_doc(doc: dict) -> dict:
    """Ergänzt jeden Block um 'sent': Liste von [start, end]."""
    idx = 0
    for ch in doc["chapters"]:
        ch_idx = 0
        for b in ch["blocks"]:
            if b["type"] in ("h1", "h2"):
                # Überschriften bekommen keine Satznummer: die Nummerierung soll
                # zwischen Report, overrides.json und Reader identisch sein.
                b["sent"], b["sid"] = [], []
                b["words"] = word_count(b["text"])
                continue
            spans = sentence_spans(b["text"])
            b["sent"] = [[s, e] for s, e in spans]
            b["sid"] = []
            for _ in spans:
                idx += 1
                ch_idx += 1
                b["sid"].append(ch_idx)
            b["words"] = word_count(b["text"])
        ch["n_sentences"] = ch_idx
    doc["meta"]["n_sentences"] = idx
    doc["meta"]["n_words"] = sum(b["words"] for c in doc["chapters"] for b in c["blocks"])
    return doc
