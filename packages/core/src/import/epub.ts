import { DomUtils, parseDocument } from "htmlparser2";
import JSZip from "jszip";
import type { Chapter, Doc } from "../pipeline/types.js";
import { blocksFromHtml } from "./html-blocks.js";

type Node = ReturnType<typeof parseDocument>;
type El = ReturnType<typeof DomUtils.findAll>[number];

const local = (name: string) => name.slice(name.indexOf(":") + 1).toLowerCase();

function findAll(root: Node | El, name: string): El[] {
  return DomUtils.findAll((el) => local(el.name) === name, "children" in root ? root.children : []);
}

function findOne(root: Node | El, name: string): El | undefined {
  return findAll(root, name)[0];
}

const xml = (s: string) => parseDocument(s, { xmlMode: true, decodeEntities: true });

/** POSIX-Pfad zusammensetzen und normalisieren (`OEBPS/../x.xhtml` → `x.xhtml`). */
function joinPath(base: string, href: string): string {
  const parts = (base ? `${base}/${href}` : href).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

const dirname = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

async function readText(zip: JSZip, path: string): Promise<string | null> {
  const f = zip.file(path) ?? zip.file(decodeURIComponent(path));
  return f ? f.async("string") : null;
}

/** href → Titel aus nav.xhtml bzw. toc.ncx (best effort). */
async function tocTitles(zip: JSZip): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const name of Object.keys(zip.files)) {
    const low = name.toLowerCase();
    if (!low.endsWith("toc.ncx") && !low.endsWith("nav.xhtml")) continue;
    const doc = xml((await readText(zip, name)) ?? "");
    // Links sind relativ zur TOC-Datei – als vollständiger Pfad ablegen
    const add = (href: string, txt: string) => {
      const key = joinPath(dirname(name), decodeURIComponent(href.split("#")[0]!));
      if (txt && !out.has(key)) out.set(key, txt);
    };
    if (low.endsWith("toc.ncx")) {
      for (const np of findAll(doc, "navpoint")) {
        const lbl = findOne(np, "text");
        const src = np.children.find((c): c is El => "name" in c && local(c.name) === "content");
        if (lbl && src?.attribs.src) add(src.attribs.src, DomUtils.textContent(lbl).trim());
      }
    } else {
      for (const a of findAll(doc, "a")) {
        if (a.attribs.href) add(a.attribs.href, DomUtils.textContent(a).trim());
      }
    }
  }
  return out;
}

export async function importEpub(bytes: Uint8Array | ArrayBuffer, fileName = "buch.epub"): Promise<Doc> {
  const zip = await JSZip.loadAsync(bytes);
  const container = await readText(zip, "META-INF/container.xml");
  if (!container) throw new Error("Kein gültiges EPUB: META-INF/container.xml fehlt.");
  const opfPath = findOne(xml(container), "rootfile")?.attribs["full-path"];
  if (!opfPath) throw new Error("Kein gültiges EPUB: rootfile fehlt.");
  const opfText = await readText(zip, opfPath);
  if (!opfText) throw new Error(`Kein gültiges EPUB: ${opfPath} fehlt.`);
  const opf = xml(opfText);
  const base = dirname(opfPath);

  const meta: Doc["meta"] = {};
  const metadata = findOne(opf, "metadata");
  if (metadata) {
    for (const [key, tag] of [["title", "title"], ["author", "creator"], ["language", "language"],
      ["publisher", "publisher"], ["date", "date"]] as const) {
      const el = findOne(metadata, tag);
      const v = el ? DomUtils.textContent(el).trim() : "";
      if (v) meta[key] = v;
    }
  }

  const items = new Map<string, { href: string; type: string; props: string[] }>();
  for (const it of findAll(opf, "item")) {
    items.set(it.attribs.id ?? "", {
      href: it.attribs.href ?? "",
      type: it.attribs["media-type"] ?? "",
      props: (it.attribs.properties ?? "").split(/\s+/),
    });
  }

  const titles = await tocTitles(zip);
  const chapters: Chapter[] = [];
  const spine = findAll(opf, "itemref");
  for (let i = 0; i < spine.length; i++) {
    const it = items.get(spine[i]!.attribs.idref ?? "");
    if (!it || it.props.includes("nav")) continue;
    if (it.type && !it.type.includes("html")) continue;
    const href = joinPath(base, it.href);
    const html = await readText(zip, href);
    if (html === null) continue;
    const blocks = blocksFromHtml(html);
    if (!blocks.length) continue;
    let title = titles.get(href) ?? "";
    const heads = blocks.slice(0, 3).filter((b) => b.type === "h1" || b.type === "h2").map((b) => b.text);
    if (heads.length) title = [...new Set(heads)].join(" – ");
    if (!title) title = `Kapitel ${i + 1}`;
    chapters.push({ id: `ch${String(i + 1).padStart(3, "0")}`, src: href, title, blocks });
  }

  meta.title ??= fileName.replace(/\.[^.]+$/, "");
  meta.source = fileName;
  meta.source_format = "epub";
  return { meta, chapters };
}
