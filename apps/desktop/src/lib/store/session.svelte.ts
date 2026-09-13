/**
 * Eine geöffnete Buchdatei: aktueller Stand, Rückgängig/Wiederholen,
 * Speichern und automatische Sicherung.
 */
import {
  applyBookPatches, applyEdit, bookStats, bookToJson, buildLookup, describeEdit, EditError, reviewQueue,
  setProgress, type Book, type Edit, type Patch,
} from "@sprechbuch/core";
import type { Platform } from "../platform";
import { packHbook } from "../worker/protocol";
import { saveSnapshot, saveSource } from "./persist";

interface HistoryEntry {
  label: string;
  patches: Patch[];
  inverse: Patch[];
  revBefore: number;
  revAfter: number;
}

export interface Position {
  block: string;
  sentence: number;
}

const HISTORY_LIMIT = 500;
let revCounter = 0;

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "error";
}

export class BookSession {
  book: Book = $state.raw(null as unknown as Book);
  source: Uint8Array | null = null;
  savedPath: string | null = $state(null);
  /** Leseposition – getrennt vom Buchzustand, damit Weiterblättern den Text nicht neu rendert */
  position: Position | null = $state(null);

  rev = $state(0);
  savedRev = $state(0);
  undoStack: HistoryEntry[] = $state.raw([]);
  redoStack: HistoryEntry[] = $state.raw([]);
  saving = $state(false);
  toast: Toast | null = $state(null);

  lookup = $derived(buildLookup(this.book));
  stats = $derived(bookStats(this.book));
  queue = $derived(reviewQueue(this.book, undefined, this.lookup));
  dirty = $derived(this.rev !== this.savedRev);
  canUndo = $derived(this.undoStack.length > 0);
  canRedo = $derived(this.redoStack.length > 0);
  undoLabel = $derived(this.undoStack.at(-1)?.label ?? "");
  redoLabel = $derived(this.redoStack.at(-1)?.label ?? "");

  #persistTimer: ReturnType<typeof setTimeout> | null = null;
  #toastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(init: { book: Book; source: Uint8Array | null; savedPath: string | null; dirty?: boolean; persistSource?: boolean }) {
    this.book = init.book;
    this.source = init.source;
    this.savedPath = init.savedPath;
    this.position = init.book.progress ? { ...init.book.progress } : null;
    this.rev = ++revCounter;
    this.savedRev = init.dirty ? -1 : this.rev;
    if (init.source && init.persistSource !== false) void saveSource(init.book.id, init.source).catch(() => {});
    this.persistNow();
  }

  get fileName(): string {
    const base = this.savedPath?.split(/[\\/]/).pop() ?? this.book.meta.source.fileName;
    return base.replace(/\.[^.]+$/, "");
  }

  // ------------------------------------------------------------------------ //
  // Bearbeiten
  // ------------------------------------------------------------------------ //

  /** Wendet einen Befehl an; liefert die ID eines neu angelegten Objekts. Fehler werden als Hinweis gezeigt. */
  apply(edit: Edit): string | undefined {
    try {
      const res = applyEdit(this.book, edit);
      if (!res.patches.length) return res.created;
      const revBefore = this.rev;
      this.book = res.book;
      this.rev = ++revCounter;
      this.undoStack = [...this.undoStack.slice(-(HISTORY_LIMIT - 1)),
        { label: describeEdit(edit), patches: res.patches, inverse: res.inverse, revBefore, revAfter: this.rev }];
      this.redoStack = [];
      this.schedulePersist();
      return res.created;
    } catch (err) {
      if (err instanceof EditError) {
        this.notify(err.message, "error");
        return undefined;
      }
      throw err;
    }
  }

  undo(): void {
    const entry = this.undoStack.at(-1);
    if (!entry) return;
    this.book = applyBookPatches(this.book, entry.inverse);
    this.rev = entry.revBefore;
    this.undoStack = this.undoStack.slice(0, -1);
    this.redoStack = [...this.redoStack, entry];
    this.notify(`Rückgängig: ${entry.label}`);
    this.schedulePersist();
  }

  redo(): void {
    const entry = this.redoStack.at(-1);
    if (!entry) return;
    this.book = applyBookPatches(this.book, entry.patches);
    this.rev = entry.revAfter;
    this.redoStack = this.redoStack.slice(0, -1);
    this.undoStack = [...this.undoStack, entry];
    this.notify(`Wiederholt: ${entry.label}`);
    this.schedulePersist();
  }

  setPosition(pos: Position): void {
    if (this.position?.block === pos.block && this.position.sentence === pos.sentence) return;
    this.position = pos;
    this.schedulePersist();
  }

  /** Buch inklusive aktueller Leseposition – so wird gespeichert. */
  snapshotBook(): Book {
    return this.position ? setProgress(this.book, this.position.block, this.position.sentence) : this.book;
  }

  // ------------------------------------------------------------------------ //
  // Speichern
  // ------------------------------------------------------------------------ //

  async save(platform: Platform, saveAs = false): Promise<boolean> {
    if (this.saving) return false;
    this.saving = true;
    const rev = this.rev;
    try {
      const bytes = await packHbook(this.snapshotBook(), this.source);
      const target = !saveAs && platform.canOverwrite && this.savedPath ? this.savedPath : undefined;
      const path = await platform.saveFile(bytes, `${this.fileName}.hbook`, "hbook", target);
      if (!path) return false;
      this.savedPath = path;
      this.savedRev = rev;
      this.persistNow();
      this.notify(platform.canOverwrite ? `Gespeichert: ${path}` : `Heruntergeladen: ${path}`);
      return true;
    } catch (err) {
      this.notify(`Speichern fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`, "error");
      return false;
    } finally {
      this.saving = false;
    }
  }

  async exportJson(platform: Platform): Promise<void> {
    try {
      const bytes = new TextEncoder().encode(bookToJson(this.snapshotBook()));
      const path = await platform.saveFile(bytes, `${this.fileName}.json`, "json");
      if (path) this.notify(`Als JSON exportiert: ${path}`);
    } catch (err) {
      this.notify(`Export fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }

  // ------------------------------------------------------------------------ //
  // Automatische Sicherung
  // ------------------------------------------------------------------------ //

  schedulePersist(): void {
    if (this.#persistTimer) clearTimeout(this.#persistTimer);
    this.#persistTimer = setTimeout(() => this.persistNow(), 700);
  }

  persistNow(): void {
    if (this.#persistTimer) clearTimeout(this.#persistTimer);
    this.#persistTimer = null;
    void saveSnapshot({
      id: this.book.id,
      book: this.snapshotBook(),
      savedPath: this.savedPath,
      dirty: this.rev !== this.savedRev,
      updatedAt: new Date().toISOString(),
    }).catch((err) => this.notify(`Automatische Sicherung fehlgeschlagen: ${String(err)}`, "error"));
  }

  notify(text: string, kind: Toast["kind"] = "info"): void {
    if (this.#toastTimer) clearTimeout(this.#toastTimer);
    this.toast = { id: Date.now(), text, kind };
    this.#toastTimer = setTimeout(() => (this.toast = null), kind === "error" ? 6000 : 2500);
  }

  dispose(): void {
    this.persistNow();
    if (this.#toastTimer) clearTimeout(this.#toastTimer);
  }
}
