import { Parser } from "htmlparser2";
import type { Block, BlockType, FormatKind, FormatMark } from "../pipeline/types.js";

const BLOCK_TAGS: Record<string, BlockType> = {
  p: "p", div: "p", li: "p", dd: "p", dt: "p",
  h1: "h1", h2: "h1", h3: "h2", h4: "h2", h5: "h2", h6: "h2",
  blockquote: "quote", pre: "verse",
};
const SKIP_TAGS = new Set(["script", "style", "head", "title", "svg", "table"]);
const EMPH_TAGS: Record<string, FormatKind> = { em: "em", i: "em", strong: "strong", b: "strong", u: "em" };

/** Zeichen, deren Folgen zu einem Leerzeichen zusammenfallen (wie `_WS` in der Referenz). */
const COLLAPSE = new Set([" ", "\t", "\r", "\n", " ", " ", " "]);

/**
 * Zerlegt (X)HTML in Blöcke mit Text und Auszeichnungs-Offsets.
 *
 * Anders als die Python-Referenz wird der Leerraum schon beim Einlesen
 * zusammengefasst – dadurch stimmen die Offsets von Kursiv/Fett exakt mit dem
 * gespeicherten Text überein (die Referenz rechnete sie vor dem Zusammenfassen).
 */
class BlockExtractor {
  readonly blocks: Block[] = [];
  private text = "";
  private pendingSpace = false;
  private type: BlockType = "p";
  private marks: FormatMark[] = [];
  private open: { k: FormatKind; start: number }[] = [];
  private skip = 0;

  private append(data: string): void {
    for (const ch of data) {
      if (COLLAPSE.has(ch)) {
        if (this.text.length > 0) this.pendingSpace = true;
        continue;
      }
      if (this.pendingSpace) {
        this.text += " ";
        this.pendingSpace = false;
      }
      this.text += ch;
    }
  }

  private flush(): void {
    let text = this.text;
    const lead = /^\s*/u.exec(text)![0].length;
    text = text.trim();
    if (text) {
      const marks = this.marks
        .map((m) => ({ s: Math.max(0, m.s - lead), e: Math.min(text.length, m.e - lead), k: m.k }))
        .filter((m) => m.e > m.s);
      this.blocks.push({ type: this.type, text, marks });
    }
    this.text = "";
    this.pendingSpace = false;
    this.marks = [];
    this.open = [];
    this.type = "p";
  }

  onOpen(tag: string): void {
    if (SKIP_TAGS.has(tag)) {
      this.skip++;
      return;
    }
    if (this.skip) return;
    if (tag === "br") {
      this.append(" ");
      return;
    }
    const bt = BLOCK_TAGS[tag];
    if (bt) {
      this.flush();
      this.type = bt;
      return;
    }
    const k = EMPH_TAGS[tag];
    if (k) this.open.push({ k, start: this.text.length + (this.pendingSpace ? 1 : 0) });
  }

  onClose(tag: string): void {
    if (SKIP_TAGS.has(tag)) {
      this.skip = Math.max(0, this.skip - 1);
      return;
    }
    if (this.skip) return;
    if (BLOCK_TAGS[tag]) {
      this.flush();
      return;
    }
    const k = EMPH_TAGS[tag];
    if (!k) return;
    for (let i = this.open.length - 1; i >= 0; i--) {
      if (this.open[i]!.k === k) {
        const [o] = this.open.splice(i, 1);
        this.marks.push({ s: o!.start, e: this.text.length, k });
        break;
      }
    }
  }

  onText(data: string): void {
    if (!this.skip) this.append(data);
  }

  end(): void {
    this.flush();
  }
}

export function blocksFromHtml(html: string): Block[] {
  const ex = new BlockExtractor();
  const parser = new Parser(
    {
      // Implizite Tags (vom HTML-Parser ergänzt) ignorieren – die Referenz kennt sie nicht.
      onopentag: (name, _attrs, implied) => { if (!implied) ex.onOpen(name); },
      onclosetag: (name, implied) => { if (!implied) ex.onClose(name); },
      ontext: (t) => ex.onText(t),
    },
    { decodeEntities: true, lowerCaseTags: true, recognizeSelfClosing: true },
  );
  parser.write(html);
  parser.end();
  ex.end();
  return ex.blocks;
}
