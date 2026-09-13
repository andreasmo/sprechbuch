# -*- coding: utf-8 -*-
"""Erkennung direkter Rede: Anführungsstil bestimmen und Redespannen finden."""

from __future__ import annotations

import re

# (Öffner, Schließer, Name)
PAIRS = [
    ("»", "«", "guillemets_de"),
    ("«", "»", "guillemets_fr"),
    ("„", "“", "low_high_de"),
    ("“", "”", "curly_en"),
    ('"', '"', "straight"),
]
INNER_PAIRS = [("‚", "‘"), ("›", "‹"), ("‹", "›"), ("'", "'")]
DASH_START = re.compile(r"^\s*[–—]\s+")


def detect_style(doc: dict) -> dict:
    """Ermittelt den dominanten Anführungsstil des Dokuments."""
    text = "\n".join(b["text"] for ch in doc["chapters"] for b in ch["blocks"])
    counts = {c: text.count(c) for c in set("»«„“”\"")}

    # Guillemets: Reihenfolge des ersten Auftretens entscheidet über die Richtung
    if counts.get("»", 0) + counts.get("«", 0) > 10:
        de = fr = 0
        for ch in doc["chapters"]:
            for b in ch["blocks"]:
                a, z = b["text"].find("»"), b["text"].find("«")
                if a >= 0 and z >= 0:
                    de += a < z
                    fr += z < a
        return {"open": "»", "close": "«", "name": "guillemets_de"} if de >= fr else \
               {"open": "«", "close": "»", "name": "guillemets_fr"}
    if counts.get("„", 0) > 10:
        close = "“" if counts.get("“", 0) >= counts.get("”", 0) else "”"
        return {"open": "„", "close": close, "name": "low_high_de"}
    if counts.get("“", 0) > 10:
        return {"open": "“", "close": "”", "name": "curly_en"}
    if counts.get('"', 0) > 10:
        return {"open": '"', "close": '"', "name": "straight"}

    dash = sum(1 for ch in doc["chapters"] for b in ch["blocks"]
               if b["type"] == "p" and DASH_START.match(b["text"]))
    total = sum(1 for ch in doc["chapters"] for b in ch["blocks"] if b["type"] == "p") or 1
    if dash / total > 0.2:
        return {"open": "—", "close": "", "name": "dash"}
    return {"open": "", "close": "", "name": "none"}


def _spans_paired(text: str, o: str, c: str) -> list[dict]:
    out, i, n = [], 0, len(text)
    if o == c:                                   # gerade Anführungszeichen: togglen
        pos = [m.start() for m in re.finditer(re.escape(o), text)]
        for a, b in zip(pos[0::2], pos[1::2]):
            out.append({"s": a, "e": b + 1, "open_end": False})
        if len(pos) % 2:
            out.append({"s": pos[-1], "e": n, "open_end": True})
        return out
    while i < n:
        a = text.find(o, i)
        if a < 0:
            break
        b = text.find(c, a + 1)
        if b < 0:
            out.append({"s": a, "e": n, "open_end": True})
            break
        out.append({"s": a, "e": b + 1, "open_end": False})
        i = b + 1
    return out


def _spans_dash(text: str) -> list[dict]:
    m = DASH_START.match(text)
    if not m:
        return []
    end = len(text)
    m2 = re.search(r"\s[–—]\s", text[m.end():])
    if m2:
        end = m.end() + m2.start()
    return [{"s": m.start(), "e": end, "open_end": False}]


def find_speech(doc: dict, style: dict | None = None) -> dict:
    """Ergänzt jeden Block um 'speech': [{s,e,open_end,cont}] und setzt meta.quote_style."""
    style = style or detect_style(doc)
    doc["meta"]["quote_style"] = style
    o, c = style["open"], style["close"]

    for ch in doc["chapters"]:
        carry = False                              # offene Rede aus vorigem Absatz
        for b in ch["blocks"]:
            if b["type"] in ("h1", "h2") or not o:
                b["speech"] = []
                continue
            spans = _spans_dash(b["text"]) if style["name"] == "dash" \
                else _spans_paired(b["text"], o, c)
            for i, sp in enumerate(spans):
                sp["cont"] = bool(carry and i == 0)
                sp["inner"] = False
            # verschachtelte Zitate innerhalb der Rede
            for io, ic in INNER_PAIRS:
                if io == ic:
                    continue
                for sp in _spans_paired(b["text"], io, ic):
                    if any(x["s"] < sp["s"] and sp["e"] <= x["e"] for x in spans):
                        sp.update(cont=False, inner=True)
                        spans.append(sp)
            spans.sort(key=lambda x: (x["s"], -x["e"]))
            b["speech"] = spans
            carry = bool(spans) and spans[-1].get("open_end") and not spans[-1]["inner"]
    return doc
