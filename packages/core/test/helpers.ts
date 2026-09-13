import JSZip from "jszip";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { analyze, importBook, type Doc } from "../src/index.js";

/** Minimales, gültiges EPUB 3 aus Kapitel-HTML. */
export async function makeEpub(
  chapters: { file: string; body: string }[],
  meta: { title?: string; author?: string } = {},
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);
  const items = chapters.map((c, i) => `<item id="c${i}" href="text/${c.file}" media-type="application/xhtml+xml"/>`).join("\n");
  const spine = chapters.map((_, i) => `<itemref idref="c${i}"/>`).join("\n");
  zip.file("OEBPS/content.opf", `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">urn:uuid:test</dc:identifier>
    <dc:title>${meta.title ?? "Testbuch"}</dc:title>
    ${meta.author ? `<dc:creator>${meta.author}</dc:creator>` : ""}
    <dc:language>de</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${items}
  </manifest>
  <spine><itemref idref="nav"/>${spine}</spine>
</package>`);
  zip.file("OEBPS/nav.xhtml", `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>
<nav epub:type="toc"><ol>${chapters.map((c, i) => `<li><a href="text/${c.file}">Inhalt ${i + 1}</a></li>`).join("")}</ol></nav>
</body></html>`);
  for (const c of chapters) {
    zip.file(`OEBPS/text/${c.file}`, `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title><style>p{}</style></head>
<body>${c.body}</body></html>`);
  }
  return zip.generateAsync({ type: "uint8array" });
}

/** Dokument direkt aus Absätzen (ein Kapitel) – für Pipeline-Tests ohne Import. */
export function docFrom(paras: string[], opts: Parameters<typeof analyze>[1] = {}): Doc {
  return analyze(
    {
      meta: { title: "Test" },
      chapters: [{ id: "ch001", src: "", title: "Test", blocks: paras.map((text) => ({ type: "p", text, marks: [] })) }],
    },
    opts,
  );
}

export interface PdfLine {
  text: string;
  x?: number;
  size?: number;
  bold?: boolean;
  /** Zusätzlicher Abstand davor (pt). */
  gapBefore?: number;
  centered?: boolean;
}

/** PDF mit wiederkehrender Kopfzeile, Seitenzahl und frei gesetzten Zeilen. */
export async function makePdf(pages: PdfLine[][], header = "Testbuch – Probe"): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Probe-PDF");
  pdf.setAuthor("Test Autorin");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 420;
  const H = 595;
  const margin = 50;
  pages.forEach((lines, pi) => {
    const page = pdf.addPage([W, H]);
    page.drawText(header, { x: margin, y: H - 40, size: 9, font: regular });
    let y = H - 80;
    for (const l of lines) {
      const size = l.size ?? 11;
      const font = l.bold ? bold : regular;
      y -= l.gapBefore ?? 0;
      const x = l.centered ? (W - font.widthOfTextAtSize(l.text, size)) / 2 : margin + (l.x ?? 0);
      page.drawText(l.text, { x, y, size, font });
      y -= size * 1.35;
    }
    page.drawText(String(pi + 1), { x: W / 2, y: 30, size: 9, font: regular });
  });
  return pdf.save();
}

/** Vierseitiges Probe-PDF: Einzüge, Trennung, Seitenumbruch im Absatz, zwei Kapitel. */
const indent = 15;
export const PDF_PAGES: PdfLine[][] = [
  [
    { text: "Kapitel 1", size: 18, bold: true, centered: true, gapBefore: 10 },
    { text: "Anna stand lange am Ufer und sah dem kleinen Boot", x: indent, gapBefore: 8 },
    { text: "nach, das langsam in der Dämmerung am Horizont ver-" },
    { text: "schwand. Der Wind trug den Geruch von Regen herüber." },
    { text: "»Kommst du mit?«, fragte Jonas. »Es wird bald dunkel", x: indent },
    { text: "und die Fähre fährt heute nur noch ein einziges Mal.«" },
    { text: "»Gleich«, antwortete Anna und griff nach der Tasche.", x: indent },
  ],
  [
    { text: "Sie nahm die Laterne vom Haken und folgte ihm den", x: indent },
    { text: "schmalen Pfad hinunter zum hölzernen Steg, wo das" },
  ],
  [
    { text: "Wasser leise und gleichmäßig gegen die Pfähle schlug." },
    { text: "Kapitel 2", size: 18, bold: true, centered: true, gapBefore: 20 },
    { text: "Am nächsten Morgen lag der Fluss still und grau unter", gapBefore: 8 },
    { text: "einer dichten Decke aus Nebel, der nicht weichen wollte." },
    { text: "Niemand im Dorf sprach über das, was in der Nacht am", gapBefore: 14 },
    { text: "Steg geschehen war, und niemand fragte danach." },
  ],
  // Neue Seite: Absatzbeginn nur am Einzug erkennbar – ohne Einzug wäre es eine Fortsetzung
  [{ text: "Ende der Probe.", x: indent }],
];

/** Kleines Buch mit zwei Kapiteln, drei Figuren, sicheren und unsicheren Zuordnungen. */
export async function sampleBook() {
  const bytes = await makeEpub([
    { file: "k1.xhtml", body: [
      "<h1>Kapitel 1</h1>",
      "<p>Anna stand am Ufer und sah dem Boot nach.</p>",
      "<p>»Kommst du mit?«, fragte Anna. »Es wird bald <em>dunkel</em>.«</p>",
      "<p>»Gleich«, antwortete Jonas.</p>",
      "<p>»Du trödelst immer.«</p>",
      "<p>»Und du bist ungeduldig.«</p>",
    ].join("") },
    { file: "k2.xhtml", body: [
      "<h1>Kapitel 2</h1>",
      "<p>»Guten Morgen«, sagte Paul. Er setzte sich zu ihnen.</p>",
      "<p>»Morgen«, sagte Anna.</p>",
    ].join("") },
  ], { title: "Am Ufer", author: "Test" });
  return { bytes, ...(await importBook(bytes, "am-ufer.epub")) };
}
