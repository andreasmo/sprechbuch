/**
 * Suche im geöffneten Buch – Zustand liegt an der Sitzung, damit Suchleiste,
 * Textansicht (Hervorhebung) und Tabs ihn teilen.
 */
import type { Book } from "@sprechbuch/core";
import { findHits, type SearchHit } from "../find";

export class SearchState {
  open = $state(false);
  query = $state("");
  /** Index des aktuellen Treffers, -1 = noch keiner angesprungen */
  index = $state(-1);

  readonly #book: () => Book;
  result = $derived.by(() => findHits(this.#book(), this.query));
  current: SearchHit | null = $derived(this.result.hits[this.index] ?? null);

  constructor(book: () => Book) {
    this.#book = book;
  }

  setQuery(q: string): void {
    this.query = q;
    this.index = -1;
  }

  /** Nächster/vorheriger Treffer, zyklisch; liefert ihn zum Anspringen */
  step(dir: 1 | -1): SearchHit | null {
    const n = this.result.hits.length;
    if (!n) return null;
    this.index = this.index < 0 ? (dir === 1 ? 0 : n - 1) : (this.index + dir + n) % n;
    return this.current;
  }

  select(hit: SearchHit): void {
    this.index = this.result.hits.indexOf(hit);
  }
}
