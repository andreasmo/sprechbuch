/**
 * Betonungen setzen – gemeinsam für Bearbeiten und Aufnehmen.
 */
import { penName } from "./markers";
import { snapSelection } from "./render";
import { settings } from "./store/settings.svelte";
import type { BookSession } from "./store/session.svelte";

/** Betonung auf ganze Wörter setzen; die Farbe merkt sich die App für den Stift. */
export function emphasize(session: BookSession, block: string, start: number, end: number, color: number | null): string | undefined {
  const text = session.lookup.blocks.get(block)?.block.text;
  if (text === undefined) return undefined;
  const [s, e] = snapSelection(text, start, end);
  if (e <= s) return undefined;
  settings.penColor = color;
  return session.apply({ type: "addMark", mark: { type: "emphasis", block, start: s, end: e, color } });
}

/** Stiftstrich im Text: Betonung in der gewählten Farbe – mit kurzer Rückmeldung, denn der Stift sieht nichts vom Menü */
export function emphasizeStrike(session: BookSession, sel: { block: string; start: number; end: number } | null): void {
  if (!sel) {
    session.notify("Stift: waagerecht durch oder unter Wörtern streichen setzt eine Betonung");
    return;
  }
  const color = settings.penColor;
  if (emphasize(session, sel.block, sel.start, sel.end, color)) {
    session.notify(color === null ? "Betonung gesetzt" : `Betonung gesetzt: ${penName(color, session.book.emphasisLabels)}`);
  }
}
