/**
 * Eine geöffnete Buchdatei: aktueller Stand, Rückgängig/Wiederholen,
 * Speichern, automatische Sicherung und Abgleich mit der Datei auf der Platte.
 */
import {
  applyBookPatches, applyEdit, bookStats, bookToJson, buildLookup, describeEdit, EditError, rebaseEdits, reviewQueue,
  setProgress, sha256Hex, type Book, type Edit, type HbookChanges, type JournalEntry, type Patch, type RebaseResult,
} from "@sprechbuch/core";
import { FileConflictError, FileMissingError, ShareNeedsTapError, siblingPath, type FileStamp, type Platform } from "../platform";
import { openHbook, packHbook } from "../worker/protocol";
import { saveSnapshot, saveSource } from "./persist";
import { SearchState } from "./search.svelte";
import { settings } from "./settings.svelte";
import { decideIncoming, deviceName, mayHaveChanged } from "./sync";
import { SessionTimer } from "./timer.svelte";

interface HistoryEntry {
  label: string;
  edit: Edit;
  created?: string;
  patches: Patch[];
  inverse: Patch[];
  revBefore: number;
  revAfter: number;
}

export interface Position {
  block: string;
  sentence: number;
}

/** Die Datei passt nicht mehr zum Stand in der App. */
export interface FileConflict {
  kind: "changed" | "missing";
  path: string;
  /** die Fassung aus der Datei (nur bei „changed“) */
  other?: { book: Book; source: Uint8Array | null; stamp: FileStamp | null };
  /** eigene Befehle seit der gemeinsamen Fassung; null = Zusammenführen nicht möglich */
  journal: JournalEntry[] | null;
}

export interface MergeReport {
  applied: number;
  unchanged: number;
  skipped: { label: string; reason: string }[];
  /** Änderungen kamen von diesem Gerät (Übergabe-Protokoll) statt aus der eigenen Sitzung */
  from?: string;
}


export interface SessionInit {
  book: Book;
  source: Uint8Array | null;
  platform: Platform;
  savedPath: string | null;
  dirty?: boolean;
  persistSource?: boolean;
  sourcePath?: string | null;
  fileStamp?: FileStamp | null;
  /** Befehle seit der gespeicherten Fassung, aus der Absturzsicherung */
  journal?: JournalEntry[] | null;
  conflict?: FileConflict | null;
  /** Web/iPad: Übergabe-Protokoll der geöffneten Datei bzw. aus der Absturzsicherung */
  handover?: HbookChanges | null;
}

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "error";
}

const HISTORY_LIMIT = 500;
/** Nach einer Änderung bzw. nach dem Weiterlesen so lange warten, bevor in die Datei geschrieben wird */
const AUTOSAVE_EDIT_MS = 2500;
const AUTOSAVE_POSITION_MS = 15_000;
let revCounter = 0;

const positionKey = (p: Position | null | undefined) => (p ? `${p.block}:${p.sentence}` : "");
const toJournal = (e: HistoryEntry): JournalEntry => ({ edit: e.edit, ...(e.created ? { created: e.created } : {}) });

export class BookSession {
  readonly platform: Platform;
  book: Book = $state.raw(null as unknown as Book);
  source: Uint8Array | null = null;
  savedPath: string | null = $state(null);
  sourcePath: string | null = null;
  // $state.raw: diese Objekte werden nur ersetzt, nie verändert – und dürfen keine Proxys werden
  // (IndexedDB und Immer brauchen einfache Objekte)
  /** Stempel der Dateifassung, auf der der Stand beruht */
  fileStamp: FileStamp | null = $state.raw(null);
  conflict: FileConflict | null = $state.raw(null);
  mergeReport: MergeReport | null = $state.raw(null);
  /** Leseposition – getrennt vom Buchzustand, damit Weiterblättern den Text nicht neu rendert */
  position: Position | null = $state(null);

  rev = $state(0);
  savedRev = $state(0);
  undoStack: HistoryEntry[] = $state.raw([]);
  redoStack: HistoryEntry[] = $state.raw([]);
  saving = $state(false);
  toast: Toast | null = $state(null);

  /** Nur die Rede dieser Figur hervorheben (Legende, Tasten 1–9) */
  isolate: string | null = $state(null);
  /** Rede dieser Figuren abblenden */
  muted: string[] = $state([]);
  readonly timer = new SessionTimer();
  readonly search = new SearchState(() => this.book);

  lookup = $derived(buildLookup(this.book));
  stats = $derived(bookStats(this.book));
  queue = $derived(reviewQueue(this.book, undefined, this.lookup));
  dirty = $derived(this.rev !== this.savedRev);
  canUndo = $derived(this.undoStack.length > 0);
  canRedo = $derived(this.redoStack.length > 0);
  undoLabel = $derived(this.undoStack.at(-1)?.label ?? "");
  redoLabel = $derived(this.redoStack.at(-1)?.label ?? "");
  /** Schreibt Änderungen selbsttätig in die Datei */
  autosaves = $derived.by(() => !!this.platform.files && !!this.savedPath && settings.autosaveFile && !this.conflict);

  #persistTimer: ReturnType<typeof setTimeout> | null = null;
  #fileTimer: ReturnType<typeof setTimeout> | null = null;
  #toastTimer: ReturnType<typeof setTimeout> | null = null;
  #savedPositionKey = "";
  #checking = false;
  #closed = false;
  /** Bei wiederhergestellten Sitzungen: Journal aus der Absturzsicherung, beginnend bei #baseRev */
  #baseRev = 0;
  #baseJournal: JournalEntry[] | null = null;
  /**
   * Nur ohne Dateizugriff (Web/iPad): Von welcher Fassung ging dieses Gerät aus, und welche Befehle
   * stehen seitdem schon in heruntergeladenen/geteilten Dateien? Wird jeder gesicherten .hbook
   * beigelegt, damit die Desktop-App die Änderungen übertragen kann.
   */
  #handover: HbookChanges | null = null;
  /** Web auf dem Tablet: fertig gepackte Datei, damit das Teilen-Menü direkt beim Tippen aufgehen kann */
  #prepared: { key: string; bytes: Uint8Array; changes: HbookChanges | null } | null = null;
  #prepareTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(init: SessionInit) {
    this.platform = init.platform;
    this.book = init.book;
    this.source = init.source;
    this.savedPath = init.savedPath;
    this.sourcePath = init.sourcePath ?? null;
    this.fileStamp = init.fileStamp ?? null;
    this.conflict = init.conflict ?? null;
    this.position = init.book.progress ? { ...init.book.progress } : null;
    this.#savedPositionKey = positionKey(init.book.progress);
    this.rev = ++revCounter;
    this.savedRev = init.dirty ? -1 : this.rev;
    this.#baseRev = this.rev;
    this.#baseJournal = init.dirty ? (init.journal ?? null) : null;
    if (!this.platform.files) {
      const base = init.handover?.base ?? init.fileStamp?.sha256;
      this.#handover = base ? { base, device: deviceName(), updatedAt: init.handover?.updatedAt ?? "", edits: init.handover?.edits ?? [] } : null;
    }
    if (init.source && init.persistSource !== false) void saveSource(init.book.id, init.source).catch(() => {});
    void this.persistNow();
    this.#schedulePrepare(0);
  }

  get fileName(): string {
    const base = this.savedPath?.split(/[\\/]/).pop() ?? this.book.meta.source.fileName;
    return base.replace(/\.[^.]+$/, "");
  }

  /** Speicherort-Vorschlag: neben der Quelldatei */
  get suggestedPath(): string {
    const name = `${this.fileName}.hbook`;
    return this.sourcePath ? siblingPath(this.sourcePath, name) : name;
  }

  get positionChanged(): boolean {
    return positionKey(this.position) !== this.#savedPositionKey;
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
      this.undoStack = [...this.undoStack.slice(-(HISTORY_LIMIT - 1)), {
        label: describeEdit(edit), edit, ...(res.created ? { created: res.created } : {}),
        patches: res.patches, inverse: res.inverse, revBefore, revAfter: this.rev,
      }];
      this.redoStack = [];
      this.#changed(AUTOSAVE_EDIT_MS);
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
    this.#changed(AUTOSAVE_EDIT_MS);
  }

  redo(): void {
    const entry = this.redoStack.at(-1);
    if (!entry) return;
    this.book = applyBookPatches(this.book, entry.patches);
    this.rev = entry.revAfter;
    this.redoStack = this.redoStack.slice(0, -1);
    this.undoStack = [...this.undoStack, entry];
    this.notify(`Wiederholt: ${entry.label}`);
    this.#changed(AUTOSAVE_EDIT_MS);
  }

  setPosition(pos: Position): void {
    if (this.position?.block === pos.block && this.position.sentence === pos.sentence) return;
    this.position = pos;
    this.#changed(AUTOSAVE_POSITION_MS);
  }

  #changed(fileDelay: number): void {
    this.schedulePersist();
    this.#scheduleFileSave(fileDelay);
    // Beim Weiterlesen seltener packen – das kostet auf dem Tablet Akku
    this.#schedulePrepare(fileDelay === AUTOSAVE_POSITION_MS ? 8000 : 1500);
  }

  /** Buch inklusive aktueller Leseposition – so wird gespeichert. */
  snapshotBook(): Book {
    return this.position ? setProgress(this.book, this.position.block, this.position.sentence) : this.book;
  }

  /**
   * Eigene Befehle seit der gespeicherten Fassung. null, wenn der Weg dorthin nicht aus
   * Befehlen besteht (z. B. über den Speicherstand hinaus rückgängig gemacht).
   */
  journal(): JournalEntry[] | null {
    if (this.rev === this.savedRev) return [];
    const i = this.undoStack.findIndex((e) => e.revBefore === this.savedRev);
    if (i >= 0) return this.undoStack.slice(i).map(toJournal);
    if (this.#baseJournal && (this.undoStack[0]?.revBefore ?? this.rev) === this.#baseRev) {
      return [...this.#baseJournal, ...this.undoStack.map(toJournal)];
    }
    return null;
  }

  // ------------------------------------------------------------------------ //
  // Speichern
  // ------------------------------------------------------------------------ //

  /**
   * Als .hbook speichern. Auf dem Desktop atomar und mit Konfliktprüfung: Wurde die Datei
   * inzwischen von außen geändert, wird nicht überschrieben, sondern `conflict` gesetzt.
   */
  async save(saveAs = false, opts: { quiet?: boolean; force?: boolean } = {}): Promise<boolean> {
    if (this.saving) return false;
    this.saving = true;
    const rev = this.rev;
    const posKey = positionKey(this.position);
    const files = this.platform.files;
    let conflictPath: string | null = null;
    try {
      if (!files) {
        // Web/iPad: teilen bzw. herunterladen – mit Übergabe-Protokoll; der Hash erkennt die Datei beim erneuten Öffnen wieder
        const prepared = this.#prepared?.key === `${rev}|${posKey}` ? this.#prepared : await this.#prepare();
        const { bytes, changes } = prepared;
        let name: string | null;
        try {
          name = await this.platform.saveFile(bytes, `${this.fileName}.hbook`, "hbook");
        } catch (err) {
          if (!(err instanceof ShareNeedsTapError)) throw err;
          this.notify(err.message);
          return false;
        }
        if (!name) return false;
        if (changes) this.#handover = changes;
        this.#saved(rev, posKey, name, { size: bytes.length, modifiedMs: Date.now(), sha256: await sha256Hex(bytes) });
        const count = changes?.edits?.length ?? 0;
        this.notify(`Gesichert: ${name}${count ? ` – mit ${count} Änderung${count === 1 ? "" : "en"} für die Desktop-App` : ""}`);
        return true;
      }
      const bytes = await packHbook(this.snapshotBook(), this.source);
      const path = saveAs ? undefined : (this.savedPath ?? undefined);
      const res = await files.saveBook(bytes, {
        path,
        suggestedPath: this.suggestedPath,
        expected: path && !opts.force ? this.fileStamp?.sha256 : undefined,
        force: opts.force,
      });
      if (!res) return false;
      this.#saved(rev, posKey, res.path, res.stamp);
      if (!opts.quiet) this.notify(`Gespeichert: ${res.path}`);
      return true;
    } catch (err) {
      if (err instanceof FileConflictError && this.savedPath) {
        conflictPath = this.savedPath;
        return false;
      }
      if (err instanceof FileMissingError && this.savedPath) {
        this.conflict = { kind: "missing", path: this.savedPath, journal: null };
        return false;
      }
      this.notify(`Speichern fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`, "error");
      return false;
    } finally {
      this.saving = false;
      if (conflictPath) {
        await this.#loadChanged(conflictPath).catch((err) =>
          this.notify(`Die geänderte Datei konnte nicht gelesen werden: ${err instanceof Error ? err.message : String(err)}`, "error"));
      }
    }
  }

  async #prepare(): Promise<{ key: string; bytes: Uint8Array; changes: HbookChanges | null }> {
    const key = `${this.rev}|${positionKey(this.position)}`;
    const changes = this.handoverChanges();
    const bytes = await packHbook(this.snapshotBook(), this.source, changes);
    const prepared = { key, bytes, changes };
    if (key === `${this.rev}|${positionKey(this.position)}`) this.#prepared = prepared;
    return prepared;
  }

  #schedulePrepare(delay: number): void {
    if (!this.platform.sharesFiles || this.#closed) return;
    if (this.#prepareTimer) clearTimeout(this.#prepareTimer);
    this.#prepareTimer = setTimeout(() => void this.#prepare().catch(() => {}), delay);
  }

  /** Web/iPad: Übergabe-Protokoll für die nächste gesicherte Datei (alle Befehle seit der Ausgangsfassung) */
  handoverChanges(): HbookChanges | null {
    const h = this.#handover;
    if (!h) return null;
    const recent = this.journal();
    return { base: h.base, device: deviceName(), updatedAt: new Date().toISOString(), edits: h.edits && recent ? [...h.edits, ...recent] : null };
  }

  #saved(rev: number, posKey: string, path: string, stamp: FileStamp): void {
    this.savedPath = path;
    this.fileStamp = stamp;
    this.savedRev = rev;
    this.#savedPositionKey = posKey;
    this.#baseJournal = null;
    this.conflict = null;
    void this.persistNow();
  }

  async exportJson(): Promise<void> {
    await this.exportText(bookToJson(this.snapshotBook()), `${this.fileName}.json`, "json");
  }

  async exportText(text: string, suggestedName: string, kind: "csv" | "json"): Promise<void> {
    try {
      const path = await this.platform.saveFile(new TextEncoder().encode(text), suggestedName, kind);
      if (path) this.notify(`Exportiert: ${path}`);
    } catch (err) {
      this.notify(`Export fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }

  #scheduleFileSave(delay: number): void {
    if (!this.autosaves) return;
    if (this.#fileTimer) clearTimeout(this.#fileTimer);
    this.#fileTimer = setTimeout(() => void this.autosave(), delay);
  }

  /** Ausstehendes in die Datei schreiben, falls automatisches Speichern greift. */
  async autosave(): Promise<void> {
    if (this.#fileTimer) clearTimeout(this.#fileTimer);
    this.#fileTimer = null;
    if (!this.autosaves || (!this.dirty && !this.positionChanged)) return;
    if (this.saving) {
      this.#scheduleFileSave(1000);
      return;
    }
    await this.save(false, { quiet: true });
  }

  // ------------------------------------------------------------------------ //
  // Abgleich mit der Datei
  // ------------------------------------------------------------------------ //

  /** Prüft, ob die Datei von außen geändert wurde (Fokus, Intervall). */
  async checkFile(): Promise<void> {
    const files = this.platform.files;
    const path = this.savedPath;
    if (!files || !path || this.conflict || this.saving || this.#checking || this.#closed) return;
    this.#checking = true;
    try {
      const quick = await files.stamp(path, false);
      if (!quick) {
        if (this.savedPath === path) this.conflict = { kind: "missing", path, journal: null };
        return;
      }
      if (mayHaveChanged(this.fileStamp, quick)) await this.#loadChanged(path);
    } catch (err) {
      console.warn("Dateiprüfung fehlgeschlagen", err);
    } finally {
      this.#checking = false;
    }
  }

  async #loadChanged(path: string): Promise<void> {
    const files = this.platform.files;
    if (!files) return;
    const file = await files.read(path);
    if (this.savedPath !== path || this.#closed) return;
    if (this.fileStamp?.sha256 && file.stamp.sha256 === this.fileStamp.sha256) {
      // Nur Zeitstempel geändert (z. B. vom Sync-Dienst neu geschrieben) – Inhalt gleich
      this.fileStamp = file.stamp;
      return;
    }
    const other = await openHbook(file.bytes);
    if (this.savedPath !== path || this.#closed) return;
    const sameBook = other.book.id === this.book.id;
    // Vom iPad/Browser ersetzt: Das Gerät konnte nicht prüfen, ob die Datei neuer war – Befehle übertragen statt ersetzen
    const incoming = sameBook ? decideIncoming(other.changes, this.fileStamp?.sha256, this.dirty) : { action: "legacy" as const };
    if (incoming.action === "adopt") {
      this.#adopt({ book: other.book, source: other.source, stamp: file.stamp }, false);
      this.notify(`Änderungen vom ${other.changes?.device ?? "anderen Gerät"} geladen.`);
      return;
    }
    if (incoming.action === "apply") {
      this.applyIncoming(incoming.edits, other.changes?.device ?? "anderes Gerät", { stamp: file.stamp, progress: other.book.progress ?? null });
      return;
    }
    if (!this.dirty && sameBook && incoming.action === "legacy") {
      this.#adopt({ book: other.book, source: other.source, stamp: file.stamp }, this.positionChanged);
      this.notify("Neuere Fassung aus der Datei geladen – sie wurde außerhalb geändert, z. B. auf einem anderen Gerät.");
      return;
    }
    this.conflict = {
      kind: "changed",
      path,
      other: { book: other.book, source: other.source, stamp: file.stamp },
      journal: sameBook ? this.journal() : null,
    };
  }

  /** Andere Fassung übernehmen; Rückgängig-Historie beginnt neu. */
  #adopt(other: NonNullable<FileConflict["other"]>, keepPosition: boolean): void {
    const pos = this.position;
    this.book = other.book;
    if (other.source) this.source = other.source;
    this.fileStamp = other.stamp;
    this.rev = ++revCounter;
    this.savedRev = this.rev;
    this.undoStack = [];
    this.redoStack = [];
    this.#baseJournal = null;
    if (this.#handover && other.stamp?.sha256) this.#handover = { base: other.stamp.sha256, device: deviceName(), updatedAt: "", edits: [] };
    const theirs = other.book.progress ? { ...other.book.progress } : null;
    this.position = keepPosition && pos && this.lookup.blocks.has(pos.block) ? pos : (theirs ?? pos);
    this.#savedPositionKey = positionKey(theirs);
    this.conflict = null;
    void this.persistNow();
    if (this.positionChanged) this.#scheduleFileSave(AUTOSAVE_POSITION_MS);
  }

  /**
   * Konflikt auflösen:
   * - `merge`: eigene Befehle auf die Dateifassung übertragen
   * - `theirs`: Dateifassung laden, eigene Änderungen verwerfen
   * - `mine`: eigene Fassung behalten; beim nächsten Speichern wird die Datei ersetzt
   */
  resolveConflict(choice: "merge" | "theirs" | "mine"): void {
    const c = this.conflict;
    if (!c?.other) return;
    if (choice === "theirs") {
      this.#adopt(c.other, false);
      this.notify("Fassung aus der Datei geladen.");
      return;
    }
    if (choice === "mine") {
      this.fileStamp = c.other.stamp;
      this.conflict = null;
      this.notify("Deine Fassung bleibt – sie ersetzt beim Speichern die Datei.");
      this.#scheduleFileSave(0);
      return;
    }
    if (!c.journal) return;
    const result = rebaseEdits(c.other.book, c.journal);
    this.#adopt(c.other, true);
    const entries: HistoryEntry[] = [];
    for (const { edit, result: r } of result.applied) {
      const revBefore = this.rev;
      this.rev = ++revCounter;
      entries.push({
        label: describeEdit(edit), edit, ...(r.created ? { created: r.created } : {}),
        patches: r.patches, inverse: r.inverse, revBefore, revAfter: this.rev,
      });
    }
    this.book = result.book;
    this.undoStack = entries.slice(-HISTORY_LIMIT);
    this.mergeReport = {
      applied: result.applied.length,
      unchanged: result.unchanged.length,
      skipped: result.skipped.map(({ label, reason }) => ({ label, reason })),
    };
    this.#changed(1000);
  }

  /**
   * Befehle eines anderen Geräts (Übergabe-Protokoll) auf den eigenen Stand übertragen. Sie landen in der
   * Rückgängig-Historie; das Ergebnis wird wie jede Änderung gespeichert – danach steht in der Datei
   * beides, ohne Protokoll.
   * `file`: die Datei, aus der die Befehle kamen, falls sie am eigenen Speicherort liegt.
   */
  applyIncoming(edits: JournalEntry[], device: string, file: { stamp: FileStamp | null; progress: Book["progress"] | null } | null = null): void {
    let result: RebaseResult;
    try {
      result = rebaseEdits(this.book, edits);
    } catch (err) {
      this.notify(`Die Änderungen vom ${device} ließen sich nicht übertragen: ${err instanceof Error ? err.message : String(err)}`, "error");
      return;
    }
    if (file?.stamp) this.fileStamp = file.stamp;
    const entries: HistoryEntry[] = [];
    for (const { edit, result: r } of result.applied) {
      const revBefore = this.rev;
      this.rev = ++revCounter;
      entries.push({
        label: describeEdit(edit), edit, ...(r.created ? { created: r.created } : {}),
        patches: r.patches, inverse: r.inverse, revBefore, revAfter: this.rev,
      });
    }
    this.book = result.book;
    this.undoStack = [...this.undoStack, ...entries].slice(-HISTORY_LIMIT);
    this.redoStack = [];
    // Weitergelesen wurde dort – beim Einsprechen ist das der aktuellere Stand
    if (file?.progress && this.lookup.blocks.has(file.progress.block)) this.position = { ...file.progress };
    this.mergeReport = {
      applied: result.applied.length,
      unchanged: result.unchanged.length,
      skipped: result.skipped.map(({ label, reason }) => ({ label, reason })),
      from: device,
    };
    // Auch ohne neue Befehle muss die Datei ersetzt werden, sonst bleibt der fremde Stand darin
    if (!result.applied.length && file?.stamp) this.savedRev = -1;
    this.#changed(1000);
  }

  /** Datei ist weg: ohne Dateibezug weiterarbeiten – beim nächsten Speichern fragt der Dialog nach dem Ort */
  detachFile(): void {
    this.savedPath = null;
    this.fileStamp = null;
    this.savedRev = -1;
    this.conflict = null;
    void this.persistNow();
  }

  // ------------------------------------------------------------------------ //
  // Automatische Sicherung
  // ------------------------------------------------------------------------ //

  schedulePersist(): void {
    if (this.#persistTimer) clearTimeout(this.#persistTimer);
    this.#persistTimer = setTimeout(() => void this.persistNow(), 700);
  }

  persistNow(): Promise<void> {
    if (this.#persistTimer) clearTimeout(this.#persistTimer);
    this.#persistTimer = null;
    const dirty = this.rev !== this.savedRev;
    return saveSnapshot({
      id: this.book.id,
      book: this.snapshotBook(),
      savedPath: this.savedPath,
      dirty,
      updatedAt: new Date().toISOString(),
      fileStamp: this.fileStamp,
      journal: dirty ? $state.snapshot(this.journal()) : [],
      sourcePath: this.sourcePath,
      handover: this.#handover,
    }).catch((err) => this.notify(`Automatische Sicherung fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`, "error"));
  }

  notify(text: string, kind: Toast["kind"] = "info"): void {
    if (this.#toastTimer) clearTimeout(this.#toastTimer);
    this.toast = { id: Date.now(), text, kind };
    this.#toastTimer = setTimeout(() => (this.toast = null), kind === "error" ? 6000 : 3000);
  }

  toggleIsolate(id: string | null): void {
    this.isolate = id === null || this.isolate === id ? null : id;
  }

  toggleMute(id: string): void {
    this.muted = this.muted.includes(id) ? this.muted.filter((m) => m !== id) : [...this.muted, id];
  }

  clearIsolation(): void {
    this.isolate = null;
    this.muted = [];
  }

  /** Beim Schließen des Buches oder der App: Ausstehendes speichern und sichern. */
  async close(): Promise<void> {
    if (this.#closed) return;
    if (this.autosaves && (this.dirty || this.positionChanged)) await this.autosave();
    this.#closed = true;
    if (this.#fileTimer) clearTimeout(this.#fileTimer);
    if (this.#prepareTimer) clearTimeout(this.#prepareTimer);
    this.#prepared = null;
    if (this.#toastTimer) clearTimeout(this.#toastTimer);
    this.timer.dispose();
    await this.persistNow();
  }
}
