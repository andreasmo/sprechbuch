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
  // crypto.subtle gibt es nur in sicheren Kontexten – im lokalen Netz über http (Test auf dem Tablet) nicht
  const digest = globalThis.crypto?.subtle
    ? new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>))
    : sha256Fallback(bytes);
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const K = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 in reinem JavaScript (FIPS 180-4) – nur als Rückfall ohne Web Crypto */
export function sha256Fallback(bytes: Uint8Array): Uint8Array {
  const len = bytes.length;
  const blocks = Math.ceil((len + 9) / 64);
  const data = new Uint8Array(blocks * 64);
  data.set(bytes);
  data[len] = 0x80;
  const view = new DataView(data.buffer);
  view.setUint32(data.length - 8, Math.floor(len / 0x20000000), false);
  view.setUint32(data.length - 4, (len << 3) >>> 0, false);
  const h = Uint32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let b = 0; b < blocks; b++) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(b * 64 + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, bb, c, d, e, f, g, hh] = h as unknown as number[];
    for (let i = 0; i < 64; i++) {
      const t1 = (hh! + (rotr(e!, 6) ^ rotr(e!, 11) ^ rotr(e!, 25)) + ((e! & f!) ^ (~e! & g!)) + K[i]! + w[i]!) >>> 0;
      const t2 = ((rotr(a!, 2) ^ rotr(a!, 13) ^ rotr(a!, 22)) + ((a! & bb!) ^ (a! & c!) ^ (bb! & c!))) >>> 0;
      hh = g; g = f; f = e; e = (d! + t1) >>> 0; d = c; c = bb; bb = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0]! + a!) >>> 0; h[1] = (h[1]! + bb!) >>> 0; h[2] = (h[2]! + c!) >>> 0; h[3] = (h[3]! + d!) >>> 0;
    h[4] = (h[4]! + e!) >>> 0; h[5] = (h[5]! + f!) >>> 0; h[6] = (h[6]! + g!) >>> 0; h[7] = (h[7]! + hh!) >>> 0;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i]!, false);
  return out;
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
