# -*- coding: utf-8 -*-
"""Erzeugt Referenzdaten für den Paritätstest des TypeScript-Kerns.

    python reference/python/dump_golden.py fixtures/local

Für jedes *.epub im Verzeichnis entsteht <name>.golden.json mit dem
Analyse-Ergebnis der Python-Referenz. Die Dateien enthalten den vollständigen
Buchtext und bleiben deshalb lokal (fixtures/local ist in .gitignore).
"""

from __future__ import annotations

import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

from hbprep import dialogue, extract, palette, segment, speakers  # noqa: E402

SPAN_KEYS = ("s", "e", "open_end", "cont", "inner", "speaker", "conf", "via")
CAST_KEYS = ("id", "name", "aliases", "gender", "lines", "words", "chapters", "first",
             "kind", "slot", "badge")


def dump(path: str) -> str:
    doc = extract.load(path)
    segment.segment_doc(doc)
    dialogue.find_speech(doc)
    speakers.attribute(doc)
    palette.assign(doc)
    out = {
        "meta": {k: doc["meta"].get(k) for k in ("title", "author", "language", "quote_style",
                                                  "n_words", "n_sentences")},
        "chapters": [{
            "id": ch["id"], "title": ch["title"], "n_sentences": ch.get("n_sentences"),
            "blocks": [{
                "type": b["type"], "text": b["text"], "sent": b.get("sent"), "sid": b.get("sid"),
                "words": b.get("words"),
                "speech": [{k: sp.get(k) for k in SPAN_KEYS} for sp in b.get("speech", [])],
            } for b in ch["blocks"]],
        } for ch in doc["chapters"]],
        "cast": [{k: c.get(k) for k in CAST_KEYS} for c in doc["cast"]],
        "chapter_colors": doc["chapter_colors"],
    }
    target = os.path.splitext(path)[0] + ".golden.json"
    with open(target, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
    return target


if __name__ == "__main__":
    folder = sys.argv[1] if len(sys.argv) > 1 else "fixtures/local"
    books = sorted(glob.glob(os.path.join(folder, "*.epub")))
    if not books:
        sys.exit("Keine EPUB-Dateien in %s" % folder)
    for p in books:
        print("·", dump(p))
