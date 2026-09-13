# -*- coding: utf-8 -*-
"""Quelle (EPUB / PDF / TXT / HTML) -> neutrales Dokumentmodell.

Dokumentmodell (doc):
    {"meta": {...},
     "chapters": [{"id": str, "title": str,
                   "blocks": [{"type": "h1|h2|p|quote|verse", "text": str,
                               "marks": [{"s": int, "e": int, "k": "em|strong"}]}]}]}

Alles Weitere (Sätze, Rede, Sprecher) wird in den anderen Modulen ergänzt.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import zipfile
from html.parser import HTMLParser
from xml.etree import ElementTree as ET

BLOCK_TAGS = {
    "p": "p", "div": "p", "li": "p", "dd": "p", "dt": "p",
    "h1": "h1", "h2": "h1", "h3": "h2", "h4": "h2", "h5": "h2", "h6": "h2",
    "blockquote": "quote", "pre": "verse",
}
SKIP_TAGS = {"script", "style", "head", "title", "svg", "table"}
EMPH_TAGS = {"em": "em", "i": "em", "strong": "strong", "b": "strong", "u": "em"}

_WS = re.compile(r"[ \t   ]+")


# --------------------------------------------------------------------------- #
# HTML / XHTML
# --------------------------------------------------------------------------- #
class _BlockExtractor(HTMLParser):
    """Zerlegt (X)HTML in Blöcke mit Text + Auszeichnungs-Spans."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: list[dict] = []
        self._buf: list[str] = []
        self._type = "p"
        self._marks: list[dict] = []
        self._open: list[tuple[str, int]] = []
        self._skip = 0

    # -- intern ---------------------------------------------------------- #
    def _len(self) -> int:
        return sum(len(x) for x in self._buf)

    def _flush(self) -> None:
        text = _WS.sub(" ", "".join(self._buf)).strip()
        if text:
            marks = [m for m in self._marks if m["e"] > m["s"]]
            self.blocks.append({"type": self._type, "text": text, "marks": marks})
        self._buf, self._marks, self._open = [], [], []
        self._type = "p"

    # -- HTMLParser ------------------------------------------------------ #
    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag in SKIP_TAGS:
            self._skip += 1
            return
        if self._skip:
            return
        if tag == "br":
            self._buf.append(" ")
            return
        if tag in BLOCK_TAGS:
            self._flush()
            self._type = BLOCK_TAGS[tag]
            return
        if tag in EMPH_TAGS:
            self._open.append((EMPH_TAGS[tag], self._len()))

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in SKIP_TAGS:
            self._skip = max(0, self._skip - 1)
            return
        if self._skip:
            return
        if tag in BLOCK_TAGS:
            self._flush()
            return
        if tag in EMPH_TAGS:
            for i in range(len(self._open) - 1, -1, -1):
                if self._open[i][0] == EMPH_TAGS[tag]:
                    kind, start = self._open.pop(i)
                    self._marks.append({"s": start, "e": self._len(), "k": kind})
                    break

    def handle_data(self, data):
        if not self._skip:
            self._buf.append(data.replace("\r", " ").replace("\n", " "))

    def close(self):
        super().close()
        self._flush()


def blocks_from_html(html: str) -> list[dict]:
    p = _BlockExtractor()
    p.feed(html)
    p.close()
    return p.blocks


# --------------------------------------------------------------------------- #
# EPUB
# --------------------------------------------------------------------------- #
NS = {
    "c": "urn:oasis:names:tc:opendocument:xmlns:container",
    "opf": "http://www.idpf.org/2007/opf",
    "dc": "http://purl.org/dc/elements/1.1/",
    "x": "http://www.w3.org/1999/xhtml",
    "ncx": "http://www.daisy.org/z3986/2005/ncx/",
}


def _epub_spine(z: zipfile.ZipFile) -> tuple[list[str], dict]:
    root = ET.fromstring(z.read("META-INF/container.xml"))
    opf_path = root.find(".//c:rootfile", NS).get("full-path")
    base = os.path.dirname(opf_path)
    opf = ET.fromstring(z.read(opf_path))

    meta = {}
    md = opf.find("opf:metadata", NS)
    if md is not None:
        for key, tag in (("title", "title"), ("author", "creator"),
                         ("language", "language"), ("publisher", "publisher"),
                         ("date", "date")):
            el = md.find("dc:" + tag, NS)
            if el is not None and el.text:
                meta[key] = el.text.strip()

    items = {}
    for it in opf.findall("opf:manifest/opf:item", NS):
        items[it.get("id")] = (it.get("href"), it.get("media-type", ""), it.get("properties", ""))

    order = []
    for ref in opf.findall("opf:spine/opf:itemref", NS):
        it = items.get(ref.get("idref"))
        if not it:
            continue
        href, mt, props = it
        if "nav" in props.split() or "xhtml" not in mt and "html" not in mt:
            if "nav" in props.split():
                continue
        path = os.path.normpath(os.path.join(base, href)).replace("\\", "/")
        order.append(path)
    return order, meta


def _epub_titles(z: zipfile.ZipFile) -> dict:
    """href -> Titel aus nav.xhtml bzw. toc.ncx (best effort)."""
    out = {}
    for name in z.namelist():
        low = name.lower()
        try:
            if low.endswith("toc.ncx"):
                root = ET.fromstring(z.read(name))
                for np in root.iter("{%s}navPoint" % NS["ncx"]):
                    lbl = np.find(".//{%s}text" % NS["ncx"])
                    src = np.find("{%s}content" % NS["ncx"])
                    if lbl is not None and src is not None and lbl.text:
                        out.setdefault(src.get("src", "").split("#")[0], lbl.text.strip())
            elif low.endswith("nav.xhtml"):
                root = ET.fromstring(z.read(name))
                for a in root.iter("{%s}a" % NS["x"]):
                    txt = "".join(a.itertext()).strip()
                    if txt:
                        out.setdefault(a.get("href", "").split("#")[0], txt)
        except ET.ParseError:
            continue
    return out


def from_epub(path: str) -> dict:
    z = zipfile.ZipFile(path)
    spine, meta = _epub_spine(z)
    titles = _epub_titles(z)
    chapters = []
    for i, href in enumerate(spine, 1):
        try:
            raw = z.read(href)
        except KeyError:
            continue
        html = raw.decode("utf-8", "replace")
        blocks = blocks_from_html(html)
        if not blocks:
            continue
        title = titles.get(os.path.basename(href)) or titles.get(href) or ""
        heads = [b["text"] for b in blocks[:3] if b["type"] in ("h1", "h2")]
        if heads:
            title = " – ".join(dict.fromkeys(heads))
        if not title:
            title = "Kapitel %d" % i
        chapters.append({
            "id": "ch%03d" % i,
            "src": href,
            "title": title,
            "blocks": blocks,
        })
    meta.setdefault("title", os.path.splitext(os.path.basename(path))[0])
    meta["source"] = os.path.basename(path)
    meta["source_format"] = "epub"
    return {"meta": meta, "chapters": chapters}


# --------------------------------------------------------------------------- #
# PDF
# --------------------------------------------------------------------------- #
def _pdf_text(path: str) -> str:
    """Text aus PDF – nutzt das erste verfügbare Werkzeug."""
    exe = shutil.which("pdftotext")
    if exe:
        out = subprocess.run([exe, "-layout", "-enc", "UTF-8", path, "-"],
                             capture_output=True)
        if out.returncode == 0 and out.stdout.strip():
            return out.stdout.decode("utf-8", "replace")
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(path)
        return "\f".join(p.get_text("text") for p in doc)
    except Exception:
        pass
    try:
        from pdfminer.high_level import extract_text
        return extract_text(path)
    except Exception:
        pass
    raise SystemExit(
        "Kein PDF-Textextraktor gefunden.\n"
        "  Installiere eines davon:\n"
        "    pip install pymupdf        (empfohlen, am robustesten)\n"
        "    pip install pdfminer.six\n"
        "    poppler-utils (pdftotext) via winget/choco/apt\n"
        "  Alternative: PDF in Calibre nach EPUB konvertieren und das EPUB verwenden."
    )


_HYPHEN_EOL = re.compile(r"(\w)[\-­‐‑]\n([a-zäöüßà-ÿ])")
_PAGENO = re.compile(r"^\s*[-–—\[]?\s*(\d{1,4}|[ivxlcdmIVXLCDM]{1,7})\s*[-–—\]]?\s*$")


def _strip_running(pages: list[str]) -> list[str]:
    """Entfernt Kopf-/Fußzeilen, die auf vielen Seiten identisch sind."""
    firsts, lasts = {}, {}
    for p in pages:
        lines = [l.strip() for l in p.splitlines() if l.strip()]
        if not lines:
            continue
        firsts[lines[0]] = firsts.get(lines[0], 0) + 1
        lasts[lines[-1]] = lasts.get(lines[-1], 0) + 1
    thr = max(3, len(pages) // 4)
    bad_first = {k for k, v in firsts.items() if v >= thr}
    bad_last = {k for k, v in lasts.items() if v >= thr}
    out = []
    for p in pages:
        lines = p.splitlines()
        while lines and (not lines[0].strip() or lines[0].strip() in bad_first
                         or _PAGENO.match(lines[0])):
            lines.pop(0)
        while lines and (not lines[-1].strip() or lines[-1].strip() in bad_last
                         or _PAGENO.match(lines[-1])):
            lines.pop()
        out.append("\n".join(lines))
    return out


def _reflow(text: str) -> list[str]:
    """Zeilenumbruch-Layout -> Absätze."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    pages = _strip_running(text.split("\f"))
    text = "\n".join(pages)
    text = _HYPHEN_EOL.sub(r"\1\2", text)

    paras, cur = [], []
    lines = text.split("\n")
    widths = [len(l.rstrip()) for l in lines if l.strip()]
    median = sorted(widths)[len(widths) // 2] if widths else 70

    for line in lines:
        raw, s = line.rstrip(), line.strip()
        if not s:
            if cur:
                paras.append(" ".join(cur))
                cur = []
            continue
        indented = len(raw) - len(raw.lstrip()) >= 2
        if cur and indented:
            paras.append(" ".join(cur))
            cur = []
        cur.append(s)
        # kurze Zeile + Satzende => Absatzende
        if len(raw) < median * 0.72 and re.search(r"[.!?…»\"'”]\s*$", s):
            paras.append(" ".join(cur))
            cur = []
    if cur:
        paras.append(" ".join(cur))
    return [_WS.sub(" ", p).strip() for p in paras if p.strip()]


_CH_HEAD = re.compile(
    r"^\s*("
    r"(?:kapitel|abschnitt|teil|buch|chapter|part|book)\s+[\dIVXLC]+"
    r"|[IVXLC]{1,7}\.?"
    r"|\d{1,3}\.?"
    r")\s*[.:–—-]?\s*(.{0,60})$", re.I)


def _split_chapters(paras: list[str], enabled: bool = True) -> list[dict]:
    """Absätze in Kapitel schneiden – Überschrift = kurze Zeile im Kapitelmuster."""
    chapters, blocks, title = [], [], ""

    def push():
        if blocks:
            chapters.append({"id": "ch%03d" % (len(chapters) + 1), "src": "",
                             "title": title or "Kapitel %d" % (len(chapters) + 1),
                             "blocks": list(blocks)})

    for p in paras:
        if enabled and len(p) < 80 and _CH_HEAD.match(p):
            push()
            blocks, title = [], p.strip()
            blocks.append({"type": "h1", "text": p, "marks": []})
        else:
            blocks.append({"type": "p", "text": p, "marks": []})
    push()
    if not chapters:
        chapters = [{"id": "ch001", "src": "", "title": "Text",
                     "blocks": [{"type": "p", "text": p, "marks": []} for p in paras]}]
    return chapters


def from_pdf(path: str, split_chapters: bool = True) -> dict:
    paras = _reflow(_pdf_text(path))
    return {"meta": {"title": os.path.splitext(os.path.basename(path))[0],
                     "source": os.path.basename(path), "source_format": "pdf"},
            "chapters": _split_chapters(paras, split_chapters)}


# --------------------------------------------------------------------------- #
# TXT
# --------------------------------------------------------------------------- #
def from_txt(path: str) -> dict:
    raw = open(path, encoding="utf-8", errors="replace").read()
    if "\n\n" in raw:
        paras = [_WS.sub(" ", p).strip() for p in re.split(r"\n\s*\n", raw)]
    else:
        paras = _reflow(raw)
    return {"meta": {"title": os.path.splitext(os.path.basename(path))[0],
                     "source": os.path.basename(path), "source_format": "txt"},
            "chapters": _split_chapters([p for p in paras if p])}


def load(path: str, **kw) -> dict:
    ext = os.path.splitext(path)[1].lower()
    if ext == ".epub":
        return from_epub(path)
    if ext == ".pdf":
        return from_pdf(path, **kw)
    if ext in (".htm", ".html", ".xhtml"):
        html = open(path, encoding="utf-8", errors="replace").read()
        return {"meta": {"title": os.path.basename(path), "source": os.path.basename(path),
                         "source_format": "html"},
                "chapters": [{"id": "ch001", "src": "", "title": "Text",
                              "blocks": blocks_from_html(html)}]}
    return from_txt(path)
