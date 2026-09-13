import { pronunciationCandidates } from "../pipeline/pronunciation.js";
import type { Doc } from "../pipeline/types.js";
import { VERSION } from "../version.js";
import {
  BOOK_FORMAT, SCHEMA_VERSION,
  type Annotation, type Book, type BookChapter, type CastEntry, type SourceFormat,
} from "./schema.js";

export interface SourceInfo {
  fileName: string;
  format: SourceFormat;
  bytes: Uint8Array;
  embedded: boolean;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const pad = (n: number, w: number) => String(n).padStart(w, "0");

/** Erzeugt aus einem analysierten Dokument eine neue Buchdatei. */
export async function createBook(doc: Doc, source: SourceInfo, now = new Date()): Promise<Book> {
  let blockNo = 0;
  let annNo = 0;
  const annotations: Annotation[] = [];
  const nextAnn = () => `a${pad(++annNo, 6)}`;

  const chapters: BookChapter[] = doc.chapters.map((ch) => ({
    id: ch.id,
    title: ch.title,
    blocks: ch.blocks.map((b) => {
      const blockId = `b${pad(++blockNo, 5)}`;
      for (const sp of b.speech ?? []) {
        if (sp.inner) {
          annotations.push({ type: "quote", id: nextAnn(), block: blockId, start: sp.s, end: sp.e, origin: "rule" });
        } else {
          annotations.push({
            type: "speech", id: nextAnn(), block: blockId, start: sp.s, end: sp.e,
            speaker: sp.speaker ?? null, origin: "rule", confidence: sp.conf ?? 0, via: sp.via ?? null,
            ...(sp.cont ? { continued: true } : {}),
          });
        }
      }
      return {
        id: blockId,
        type: b.type,
        text: b.text,
        sentences: b.sent ?? [],
        ...(b.marks.length ? { format: b.marks.map((m) => ({ start: m.s, end: m.e, kind: m.k })) } : {}),
      };
    }),
  }));

  const cast: CastEntry[] = (doc.cast ?? [])
    .filter((c) => c.lines > 0 || c.pinned)
    .map((c) => ({
      id: c.id, name: c.name, aliases: c.aliases, gender: c.gender,
      color: c.slot ?? null, badge: c.badge, voiceNote: c.note,
      kind: c.kind, origin: c.pinned ? "user" : "rule",
    }));

  const iso = now.toISOString();
  return {
    format: BOOK_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    id: crypto.randomUUID(),
    meta: {
      title: doc.meta.title ?? source.fileName,
      ...(doc.meta.author ? { author: doc.meta.author } : {}),
      ...(doc.meta.language ? { language: doc.meta.language } : {}),
      ...(doc.meta.publisher ? { publisher: doc.meta.publisher } : {}),
      ...(doc.meta.date ? { date: doc.meta.date } : {}),
      source: {
        fileName: source.fileName, format: source.format, size: source.bytes.byteLength,
        sha256: await sha256Hex(source.bytes), embedded: source.embedded,
      },
      quoteStyle: doc.meta.quote_style ?? { name: "none", open: "", close: "" },
      createdWith: `sprechbuch-core/${VERSION}`,
      createdAt: iso,
      modifiedAt: iso,
    },
    cast,
    chapters,
    annotations,
    chapterColors: doc.chapter_colors ?? {},
    pronunciations: pronunciationCandidates(doc).map((p) => ({
      term: p.term, kind: p.kind, count: p.count, hint: "", ipa: "", origin: "rule" as const, verified: false,
    })),
    progress: null,
  };
}
