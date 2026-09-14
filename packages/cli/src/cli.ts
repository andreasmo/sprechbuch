/**
 * sprechbuch – Kommandozeile
 *
 *   sprechbuch import <buch.epub|buch.pdf> [-o buch.hbook]
 *   sprechbuch info <buch.hbook>
 *   sprechbuch export-json <buch.hbook> [-o buch.json]
 *   sprechbuch import-json <buch.json> [-o buch.hbook] [--source original.epub]
 *   sprechbuch validate <buch.hbook|buch.json>
 *   sprechbuch ai <buch.hbook> [--provider anthropic] [--model …]
 *   sprechbuch eval <geprüft.hbook> [--provider …]
 */
import { readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  bookFromJson, BookFormatError, bookStats, bookToJson, importBook, MARKER_SLOTS, QUOTE_STYLES,
  LlmError, readHbook, UnsupportedFormatError, VERSION, writeHbook, type Book, type ImportStage, type PdfJsLike,
} from "@sprechbuch/core";
import { AI_HELP, accuracyTable, compareSpeakers, runAi, type AiArgs } from "./ai.js";

const HELP = `Sprechbuch ${VERSION} – Bücher als Leseskript für die Hörbuch-Aufnahme

Befehle:
  import <datei>        EPUB oder PDF analysieren und als .hbook speichern
      -o, --out <datei>     Ziel (Standard: neben der Quelle, Endung .hbook)
      --chapters <liste>    Kapitelauswahl, z. B. 2-13 oder 1,3,5-7
      --min-words <n>       kürzere Kapitel verwerfen (Titelei, Impressum)
      --quotes <stil>       Anführungsstil erzwingen: ${Object.keys(QUOTE_STYLES).join(", ")}
      --no-source           Originaldatei nicht in die .hbook einbetten
  info <buch.hbook>     Umfang, Figuren und Qualität der Sprecherzuordnung
  export-json <buch.hbook> [-o buch.json]
  import-json <buch.json> [-o buch.hbook] [--source original]
  validate <datei>      .hbook oder .json prüfen
${AI_HELP}

Allgemein:
  --json                Ausgabe als JSON (info, validate)
  -h, --help            diese Hilfe
  -v, --version         Version
`;

const VIA_LABEL: Record<string, string> = {
  inquit_after: "Inquit nach der Rede",
  inquit_before: "Inquit vor der Rede",
  same_paragraph: "gleicher Absatz",
  continuation: "Fortsetzung",
  pronoun: "Pronomen aufgelöst",
  inquit_paragraph: "Inquit weiter vorn im Absatz",
  proximity: "Nähe (geraten)",
  alternation: "Wechselrede (geraten)",
  llm: "KI",
  unknown: "nicht zugeordnet",
  user: "manuell",
};

const STAGE_LABEL: Record<ImportStage, string> = {
  read: "lese Datei", sentences: "Sätze", speech: "direkte Rede", speakers: "Sprecher", colors: "Farben", book: "Buchdatei",
};

/** npm -w startet Skripte im Paketordner – Pfade relativ zum Aufrufort auflösen. */
const cwd = process.env.INIT_CWD ?? process.cwd();
const abs = (p: string) => (isAbsolute(p) ? p : resolve(cwd, p));
const withExt = (p: string, ext: string) => join(dirname(p), basename(p, extname(p)) + ext);
const fmt = (n: number) => n.toLocaleString("de-DE");

async function loadPdfjs(): Promise<{ pdfjs: PdfJsLike; params: Record<string, unknown> }> {
  const url = import.meta.resolve("pdfjs-dist/legacy/build/pdf.mjs");
  const pdfjs = (await import(url)) as unknown as PdfJsLike;
  // Schriftdaten für Standardschriften (Helvetica & Co.); pdf.js verlangt »/« am Ende, auch unter Windows
  const fonts = `${join(dirname(fileURLToPath(url)), "..", "..", "standard_fonts").replaceAll("\\", "/")}/`;
  return { pdfjs, params: { standardFontDataUrl: fonts, verbosity: 0 } };
}

/** Atomar schreiben: erst temporäre Datei, dann umbenennen. */
async function writeAtomic(path: string, data: Uint8Array | string): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

async function readBook(path: string): Promise<{ book: Book; source: Uint8Array | null }> {
  const bytes = await readFile(path);
  if (path.toLowerCase().endsWith(".json")) return { book: bookFromJson(bytes.toString("utf8")), source: null };
  const { book, source } = await readHbook(bytes);
  return { book, source: source?.bytes ?? null };
}

function printInfo(book: Book): void {
  const s = bookStats(book);
  const m = book.meta;
  const out: string[] = [];
  out.push(`${m.title}${m.author ? ` – ${m.author}` : ""}`);
  out.push(`  Quelle     ${m.source.fileName} (${m.source.format}${m.source.embedded ? ", eingebettet" : ""})`);
  out.push(`  Umfang     ${fmt(s.words)} Wörter · ${fmt(s.sentences)} Sätze · ${s.chapters} Kapitel · ~${Math.floor(s.minutes / 60)} h ${s.minutes % 60} min bei 150 WpM`);
  out.push(`  Rede       ${fmt(s.speech)} Redeteile, Stil ${m.quoteStyle.name} · ${fmt(s.needsReview)} zur Prüfung`);
  out.push("");
  out.push("  Zuordnung");
  const order = Object.keys(VIA_LABEL);
  for (const via of [...order, ...Object.keys(s.byVia).filter((v) => !order.includes(v))]) {
    const n = s.byVia[via];
    if (!n) continue;
    out.push(`    ${(VIA_LABEL[via] ?? via).padEnd(30)} ${String(n).padStart(6)}  ${((100 * n) / (s.speech || 1)).toFixed(1).padStart(5)} %`);
  }
  out.push("");
  out.push("  Figuren (nach Redeanteil)");
  for (const c of s.cast.slice(0, 15)) {
    const color = c.color === null ? "kapitelweise" : MARKER_SLOTS[c.color]?.name ?? "?";
    out.push(`    ${c.name.padEnd(28)} ${String(c.lines).padStart(5)} Redeteile  ${String(c.words).padStart(6)} Wörter  ${color}`);
  }
  if (s.cast.length > 15) out.push(`    … und ${s.cast.length - 15} weitere`);
  console.log(out.join("\n"));
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: "string", short: "o" },
      chapters: { type: "string" },
      "min-words": { type: "string" },
      quotes: { type: "string" },
      "no-source": { type: "boolean" },
      source: { type: "string" },
      json: { type: "boolean" },
      provider: { type: "string" },
      model: { type: "string" },
      "base-url": { type: "string" },
      tasks: { type: "string" },
      "max-cost": { type: "string" },
      "price-in": { type: "string" },
      "price-out": { type: "string" },
      "merge-cast": { type: "boolean" },
      yes: { type: "boolean", short: "y" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  if (values.version) {
    console.log(VERSION);
    return 0;
  }
  const [cmd, file] = positionals;
  if (values.help || !cmd) {
    console.log(HELP);
    return cmd ? 0 : 1;
  }
  if (!file) throw new UsageError(`»${cmd}« braucht eine Datei.`);
  const input = abs(file);

  switch (cmd) {
    case "import": {
      const quoteStyle = values.quotes ? QUOTE_STYLES[values.quotes as keyof typeof QUOTE_STYLES] : undefined;
      if (values.quotes && !quoteStyle) throw new UsageError(`Unbekannter Anführungsstil: ${values.quotes}`);
      const bytes = new Uint8Array(await readFile(input));
      const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50;
      const pdf = isPdf ? await loadPdfjs() : null;
      const t0 = performance.now();
      const { book } = await importBook(bytes, basename(input), {
        ...(pdf ? { pdfjs: pdf.pdfjs, pdfjsParams: pdf.params } : {}),
        ...(quoteStyle ? { quoteStyle } : {}),
        ...(values.chapters ? { range: values.chapters } : {}),
        ...(values["min-words"] ? { minWords: Number(values["min-words"]) } : {}),
        embedSource: !values["no-source"],
        onProgress: (stage) => process.stderr.write(`· ${STAGE_LABEL[stage]}\n`),
      });
      const target = values.out ? abs(values.out) : withExt(input, ".hbook");
      const hbook = await writeHbook(book, bytes);
      await writeAtomic(target, hbook);
      process.stderr.write(`✓ ${target} (${(hbook.byteLength / 1e6).toFixed(2)} MB, ${Math.round(performance.now() - t0)} ms)\n\n`);
      printInfo(book);
      return 0;
    }
    case "info": {
      const { book } = await readBook(input);
      if (values.json) console.log(JSON.stringify(bookStats(book), null, 2));
      else printInfo(book);
      return 0;
    }
    case "export-json": {
      const { book } = await readBook(input);
      const target = values.out ? abs(values.out) : withExt(input, ".json");
      await writeAtomic(target, bookToJson(book));
      console.log(`✓ ${target}`);
      return 0;
    }
    case "import-json": {
      const book = bookFromJson(await readFile(input, "utf8"));
      const source = values.source ? new Uint8Array(await readFile(abs(values.source))) : null;
      if (book.meta.source.embedded && !source) book.meta.source.embedded = false;
      const target = values.out ? abs(values.out) : withExt(input, ".hbook");
      await writeAtomic(target, await writeHbook(book, source));
      console.log(`✓ ${target}`);
      return 0;
    }
    case "validate": {
      const { book } = await readBook(input);
      const s = bookStats(book);
      if (values.json) console.log(JSON.stringify({ valid: true, schemaVersion: book.schemaVersion, chapters: s.chapters, annotations: book.annotations.length }));
      else console.log(`✓ gültig – Format ${book.schemaVersion}, ${s.chapters} Kapitel, ${fmt(book.annotations.length)} Markierungen`);
      return 0;
    }
    case "ai": {
      const { book, source } = await readBook(input);
      const result = await runAi(book, values as AiArgs);
      if (!result || result === book) return result ? 0 : 1;
      const target = values.out ? abs(values.out) : input;
      await writeAtomic(target, await writeHbook(result, source));
      console.log(`✓ ${target}`);
      return 0;
    }
    case "eval": {
      const { book: reference, source } = await readBook(input);
      if (!source) throw new UsageError("Das Buch enthält keine eingebettete Quelldatei – ohne sie lässt sich die reine Regel-Fassung nicht erzeugen.");
      if (!reference.annotations.some((a) => a.type === "speech" && a.origin === "user")) {
        throw new UsageError("Das Buch enthält noch keine eigenen Entscheidungen – erst in der App prüfen.");
      }
      const pdf = reference.meta.source.format === "pdf" ? await loadPdfjs() : null;
      process.stderr.write("· Regel-Fassung neu erzeugen\n");
      const { book: rules } = await importBook(source, reference.meta.source.fileName, {
        ...(pdf ? { pdfjs: pdf.pdfjs, pdfjsParams: pdf.params } : {}),
        ...(QUOTE_STYLES[reference.meta.quoteStyle.name as keyof typeof QUOTE_STYLES] ? { quoteStyle: QUOTE_STYLES[reference.meta.quoteStyle.name as keyof typeof QUOTE_STYLES] } : {}),
      });
      const rows: [string, ReturnType<typeof compareSpeakers>][] = [["nur Regeln", compareSpeakers(reference, rules)]];
      if (values.provider) {
        // Nur Kapitel mit geprüften Redeteilen fragen – spart Kosten
        const refChapters = new Set(reference.annotations.filter((a) => a.type === "speech" && a.origin === "user")
          .map((a) => reference.chapters.find((c) => c.blocks.some((b) => b.id === a.block))?.title));
        const chapters = rules.chapters.map((c, i) => (refChapters.has(c.title) ? i + 1 : 0)).filter(Boolean).join(",");
        const withAi = await runAi(rules, { ...(values as AiArgs), tasks: "speakers", chapters });
        if (withAi) rows.push([`Regeln + KI`, compareSpeakers(reference, withAi)]);
      }
      console.log(values.json ? JSON.stringify(Object.fromEntries(rows), null, 2) : accuracyTable(rows));
      return 0;
    }
    default:
      throw new UsageError(`Unbekannter Befehl: ${cmd}`);
  }
}

class UsageError extends Error {}

/** Offene HTTP-Verbindungen von fetch schließen – sonst bricht Node unter Windows beim Beenden mit einer Assertion ab */
async function closeHttp(): Promise<void> {
  const dispatcher = (globalThis as Record<symbol, { close?: () => Promise<void> } | undefined>)[Symbol.for("undici.globalDispatcher.1")];
  await dispatcher?.close?.().catch(() => {});
}

main(process.argv.slice(2)).then(
  async (code) => {
    await closeHttp();
    // Nicht process.exit(): Node soll offene Handles selbst sauber schließen
    process.exitCode = code;
  },
  async (err: unknown) => {
    await closeHttp();
    if (err instanceof UsageError) {
      console.error(`Fehler: ${err.message}

${HELP}`);
      process.exitCode = 2;
    } else if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      console.error(`Fehler: Datei nicht gefunden: ${(err as NodeJS.ErrnoException).path}`);
      process.exitCode = 1;
    } else if (err instanceof BookFormatError || err instanceof UnsupportedFormatError || err instanceof LlmError
      || (err instanceof Error && err.constructor === Error)) {
      console.error(`Fehler: ${err.message}`);
      process.exitCode = 1;
    } else {
      console.error(err);
      process.exitCode = 1;
    }
  },
);
