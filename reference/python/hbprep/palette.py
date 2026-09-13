# -*- coding: utf-8 -*-
"""Farbvergabe pro Figur.

Zwei Ebenen, damit ein Kapitel nie zwei Figuren in derselben Farbe zeigt und
die Hauptfiguren trotzdem im ganzen Buch dieselbe Farbe behalten:

  * Hauptcast  -> global feste Slots (buchweit stabil)
  * Nebenfiguren -> Slot pro Kapitel, kollisionsfrei recycelt

Redundanz für Farbfehlsichtige und Schwarz-Weiß-Druck: jede Figur trägt ein
Initialen-Badge, im Unterstreichungsmodus hat jeder Slot zusätzlich ein Muster.
"""

from __future__ import annotations

# Textmarker-Palette. Der Text bleibt schwarz bzw. hell, eingefärbt wird nur
# das Markerband:
#   tl / td  – Markerband im hellen / dunklen Thema
#   l  / d   – kräftiger Ton derselben Farbe (Badge, Legendenrand, Unterstreichung)
# Reihenfolge = Vergabereihenfolge: die am besten unterscheidbaren zuerst.
SLOTS = [
    {"name": "Gelb",    "l": "#8a6d00", "d": "#f2d64b", "tl": "#fff27a", "td": "#4d4300"},
    {"name": "Grün",    "l": "#2e7d32", "d": "#86d98a", "tl": "#bff5b0", "td": "#1e4520"},
    {"name": "Pink",    "l": "#b0276f", "d": "#ff94cb", "tl": "#ffc6e6", "td": "#561c3b"},
    {"name": "Blau",    "l": "#1f5fb8", "d": "#8cc4ff", "tl": "#b8dfff", "td": "#173a63"},
    {"name": "Orange",  "l": "#b35900", "d": "#ffb066", "tl": "#ffd5a1", "td": "#5a3310"},
    {"name": "Lila",    "l": "#6a3fc2", "d": "#c0a3ff", "tl": "#ddcbff", "td": "#35265e"},
    {"name": "Türkis",  "l": "#0b7a6e", "d": "#66dccb", "tl": "#aef1e6", "td": "#124640"},
    {"name": "Limette", "l": "#5c7a00", "d": "#cbe45f", "tl": "#e6f7a0", "td": "#3a4812"},
    {"name": "Koralle", "l": "#b3261e", "d": "#ff958b", "tl": "#ffc0b8", "td": "#57201c"},
    {"name": "Himmel",  "l": "#3f51b5", "d": "#a5b4ff", "tl": "#cfd8ff", "td": "#27305a"},
    {"name": "Sand",    "l": "#7a5c1f", "d": "#dcc38c", "tl": "#eedfb9", "td": "#473a22"},
    {"name": "Mauve",   "l": "#8a4a7a", "d": "#e0a8d2", "tl": "#ecd0e5", "td": "#4a2c43"},
]
PATTERNS = ["solid", "dashed", "dotted", "double"]
MISC = {"name": "Neben", "l": "#5c6470", "d": "#a4adba", "tl": "#e2e5ea", "td": "#2c323a"}


def initials(name: str) -> str:
    parts = [p for p in name.replace("-", " ").split() if p[:1].isalpha()]
    if not parts:
        return "?"
    if len(parts) == 1:
        return parts[0][:2].capitalize()
    return (parts[0][0] + parts[-1][0]).upper()


def assign(doc: dict, main_min_lines: int = 4, max_main: int = 12) -> dict:
    cast = doc.get("cast", [])
    by_id = {c["id"]: c for c in cast}

    # 1) Hauptcast – nach Redeanteil, respektiert vorgegebene Farben aus cast.json.
    #    Doppelt vergebene Slots werden aufgelöst: die redestärkere Figur behält
    #    ihre Farbe, die andere rückt auf eine freie.
    forced = sorted((c for c in cast if isinstance(c.get("color"), int)),
                    key=lambda c: -c["lines"])
    used: set[int] = set()
    for c in forced:
        want = c["color"]
        if 0 <= want < len(SLOTS) and want not in used:
            c["slot"] = want
            used.add(want)
        else:
            c["slot"] = None

    rest = [c for c in cast if c["lines"] >= main_min_lines
            and not isinstance(c.get("color"), int)]
    main = list(forced) + rest[:max(0, max_main - len(forced))]

    free = [i for i in range(len(SLOTS)) if i not in used]
    for c in main:
        if c.get("slot") is None:
            c["slot"] = free.pop(0) if free else None
        c["badge"] = c.get("badge") or initials(c["name"])
    for c in cast:
        c.setdefault("slot", None)
        c["badge"] = c.get("badge") or initials(c["name"])
        c["color"] = c["slot"]

    # 2) Nebenfiguren – Slot pro Kapitel, ohne Kollision
    ch_colors: dict[str, dict[str, int]] = {}
    for ch in doc["chapters"]:
        present, order = set(), []
        for b in ch["blocks"]:
            for sp in b.get("speech", []):
                cid = sp.get("speaker")
                if cid and cid not in present:
                    present.add(cid)
                    order.append(cid)
        taken = {by_id[c]["slot"] for c in present
                 if c in by_id and by_id[c]["slot"] is not None}
        local, pool = {}, [i for i in range(len(SLOTS)) if i not in taken]
        for cid in order:
            c = by_id.get(cid)
            if not c or c["slot"] is not None:
                continue
            local[cid] = pool.pop(0) if pool else None
        ch_colors[ch["id"]] = local

    doc["chapter_colors"] = ch_colors
    doc["palette"] = {"slots": SLOTS, "patterns": PATTERNS, "misc": MISC}
    return doc


def slot_for(doc: dict, chapter_id: str, cast_id: str | None) -> int | None:
    if not cast_id:
        return None
    for c in doc.get("cast", []):
        if c["id"] == cast_id and c.get("slot") is not None:
            return c["slot"]
    return doc.get("chapter_colors", {}).get(chapter_id, {}).get(cast_id)
