#!/usr/bin/env node
/**
 * Baut aus kapitel-1.txt ein kleines EPUB – und daraus mit der CLI die Beispiel-.hbook:
 *
 *   node examples/effi-briest/make-epub.mjs
 *   npm run build:cli
 *   node packages/cli/dist/cli.js import examples/effi-briest/effi-briest-kapitel-1.epub
 *
 * Feste Zeitstempel, damit das EPUB bei gleichem Text Byte für Byte gleich bleibt.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const here = dirname(fileURLToPath(import.meta.url));
const paragraphs = readFileSync(join(here, "kapitel-1.txt"), "utf8").trim().split(/\r?\n/);
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// ZIP kennt kein Datum vor 1980 – ein festes Datum genügt; Ordnereinträge (mit aktueller Zeit) weglassen
const date = new Date("2026-09-15T00:00:00Z");
const add = (zip, name, content, store = false) =>
  zip.file(name, content, { date, createFolders: false, compression: store ? "STORE" : "DEFLATE" });

const zip = new JSZip();
add(zip, "mimetype", "application/epub+zip", true);
add(zip, "META-INF/container.xml", `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`);
add(zip, "OEBPS/content.opf", `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id" xml:lang="de">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">urn:sprechbuch:beispiel:effi-briest-kapitel-1</dc:identifier>
    <dc:title>Effi Briest – Erstes Kapitel</dc:title>
    <dc:creator>Theodor Fontane</dc:creator>
    <dc:language>de</dc:language>
    <dc:date>1896</dc:date>
    <dc:rights>Gemeinfrei</dc:rights>
    <meta property="dcterms:modified">2026-09-15T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="k1" href="kapitel-1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="k1"/></spine>
</package>
`);
add(zip, "OEBPS/nav.xhtml", `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="de" xml:lang="de">
<head><title>Inhalt</title></head>
<body><nav epub:type="toc"><ol><li><a href="kapitel-1.xhtml">Erstes Kapitel</a></li></ol></nav></body>
</html>
`);
add(zip, "OEBPS/kapitel-1.xhtml", `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="de" xml:lang="de">
<head><title>Erstes Kapitel</title></head>
<body>
<h1>Erstes Kapitel</h1>
${paragraphs.map((p) => `<p>${esc(p)}</p>`).join("\n")}
</body>
</html>
`);

const out = join(here, "effi-briest-kapitel-1.epub");
writeFileSync(out, await zip.generateAsync({ type: "uint8array", platform: "UNIX", mimeType: "application/epub+zip" }));
console.log(`✓ ${out}`);
