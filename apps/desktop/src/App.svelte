<script lang="ts">
  import { sha256Hex, type ImportStage } from "@sprechbuch/core";
  import { onMount } from "svelte";
  import ImportProgress from "./lib/components/ImportProgress.svelte";
  import { LESE_APP } from "./lib/edition";
  import Start from "./lib/components/Start.svelte";
  import Workspace from "./lib/components/Workspace.svelte";
  import { detectPlatform, FileMissingError, isAbsolutePath, baseName, type PickedFile, type Platform } from "./lib/platform";
  import { loadSnapshot, loadSource, type Snapshot } from "./lib/store/persist";
  import { BookSession } from "./lib/store/session.svelte";
  import "./lib/store/settings.svelte";
  import { decideIncoming, decideOpen, samePath } from "./lib/store/sync";
  import { importSource, openHbook, openJson, type LoadedBook } from "./lib/worker/protocol";

  type View =
    | { name: "start" }
    | { name: "working"; file: string; stage: ImportStage | null }
    | { name: "book"; session: BookSession }
    | { name: "error"; message: string };

  let platform = $state<Platform | null>(null);
  let view = $state<View>({ name: "start" });
  let dragOver = $state(false);

  onMount(() => {
    const cleanups: (() => void)[] = [];
    void (async () => {
      const p = await detectPlatform();
      platform = p;
      if (!p.files) return;
      // Doppelklick auf eine .hbook-Datei, „Öffnen mit“, zweiter Programmstart
      cleanups.push(await p.files.onOpenFiles((paths) => void openPath(paths[0]!)));
      cleanups.push(await p.files.onCloseRequested(confirmClose));
      // Desktop: Drag & Drop über das Fenster liefert echte Pfade (Speicherort, Konfliktprüfung)
      cleanups.push(await p.files.onDragDrop({ over: (a) => (dragOver = a), drop: (paths) => void openPath(paths[0]!) }));
    })();
    return () => cleanups.forEach((fn) => fn());
  });

  async function show(session: BookSession) {
    if (view.name === "book" && view.session !== session) await view.session.close();
    view = { name: "book", session };
    window.scrollTo({ top: 0 });
    // Web: Browser bitten, die Absturzsicherung nicht bei Platzmangel zu löschen
    if (!session.platform.files) void navigator.storage?.persist?.().catch(() => false);
  }

  const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

  const kindOf = (f: PickedFile) => {
    const ext = f.name.toLowerCase().split(".").pop();
    return ext === "hbook" ? "hbook" : ext === "json" ? "json" : "source";
  };

  /** Sitzung aus der Absturzsicherung */
  const fromSnapshot = (p: Platform, snap: Snapshot, source: Uint8Array | null, extra: Partial<ConstructorParameters<typeof BookSession>[0]> = {}) =>
    new BookSession({
      platform: p, book: snap.book, source, savedPath: snap.savedPath, dirty: snap.dirty, persistSource: false,
      fileStamp: snap.fileStamp ?? null, journal: snap.journal ?? null, sourcePath: snap.sourcePath ?? null,
      handover: snap.handover ?? null, ...extra,
    });

  /**
   * Eine .hbook-Datei öffnen und mit der Absturzsicherung abgleichen.
   * `fromRecent`: über „Zuletzt bearbeitet“ geöffnet – dann ist ein Hinweis auf eine neuere Datei hilfreich.
   */
  async function openBookFile(p: Platform, file: PickedFile, snap: Snapshot | undefined, fromRecent = false) {
    const loaded = await openHbook(file.bytes);
    snap ??= await loadSnapshot(loaded.book.id).catch(() => undefined);
    // Ohne Pfad (Web) dient der Dateiname nur zur Anzeige; auf dem Desktop fragt dann der Dialog
    const path = file.path ?? (p.files ? null : file.name);

    // Desktop: vom iPad/Browser zurückgegebene Fassung – deren Änderungen übertragen statt den eigenen Stand zu ersetzen
    if (p.files && loaded.changes && snap && file.path) {
      const handled = await openIncoming(p, file as PickedFile & { path: string }, loaded, snap);
      if (handled) return;
    }

    const decision = decideOpen(snap, file.stamp?.sha256);

    if (decision.action === "file" || !snap) {
      const session = new BookSession({
        platform: p, book: loaded.book, source: loaded.source, savedPath: path, fileStamp: file.stamp ?? null,
        sourcePath: snap?.sourcePath ?? null, handover: loaded.changes,
      });
      await show(session);
      if (fromRecent && snap) session.notify("Die Datei war neuer als der zuletzt bearbeitete Stand – sie wurde geladen.");
      return;
    }
    const source = loaded.source ?? (await loadSource(snap.book.id).catch(() => null));
    if (decision.action === "resume") {
      const session = fromSnapshot(p, snap, source, { savedPath: path, fileStamp: file.stamp ?? snap.fileStamp ?? null });
      await show(session);
      if (snap.dirty) session.notify("Ungespeicherte Änderungen wiederhergestellt.");
      return;
    }
    // Beide Seiten geändert: eigene Fassung zeigen, Konflikt zur Entscheidung anbieten
    await show(fromSnapshot(p, snap, source, {
      savedPath: path,
      conflict: {
        kind: "changed", path: path ?? file.name,
        other: { book: loaded.book, source: loaded.source, stamp: file.stamp ?? null },
        journal: decision.canMerge && loaded.book.id === snap.book.id ? (snap.journal ?? null) : null,
      },
    }));
  }

  /**
   * Desktop, Datei mit Übergabe-Protokoll. Liefert true, wenn hier entschieden wurde.
   * - Kopie neben der eigentlichen Datei („Buch 2.hbook“): fragen, ob in die eigentliche Datei übernommen wird.
   * - Die eigentliche Datei wurde ersetzt: Befehle auf den eigenen Stand übertragen.
   */
  async function openIncoming(p: Platform, file: PickedFile & { path: string }, loaded: LoadedBook, snap: Snapshot): Promise<boolean> {
    const files = p.files!;
    const changes = loaded.changes!;
    const target = snap.savedPath && isAbsolutePath(snap.savedPath) ? snap.savedPath : null;
    if (target && !samePath(target, file.path)) {
      if (!changes.edits) return false;
      const n = changes.edits.length;
      const answer = await files.ask(
        `„${baseName(file.path)}“ ist eine Fassung vom ${changes.device} mit ${n} Änderung${n === 1 ? "" : "en"} zu „${baseName(target)}“.\n\n`
          + `In „${baseName(target)}“ übernehmen? Dort Erarbeitetes bleibt erhalten.`,
        { yes: "Übernehmen", no: "Nur diese Datei öffnen", cancel: "Abbrechen" },
        "Änderungen vom anderen Gerät",
      );
      if (answer === "cancel") {
        view = { name: "start" };
        return true;
      }
      if (answer === "no") return false;
      let targetFile: PickedFile & { path: string };
      try {
        targetFile = await files.read(target);
      } catch (err) {
        view = { name: "error", message: `„${baseName(target)}“ ließ sich nicht öffnen: ${errorText(err)}` };
        return true;
      }
      await openBookFile(p, targetFile, snap);
      if (view.name !== "book") return true;
      if (view.session.conflict) view.session.notify("Erst den Konflikt lösen, dann die Kopie noch einmal öffnen.", "error");
      else view.session.applyIncoming(changes.edits, changes.device, { stamp: null, progress: loaded.book.progress ?? null });
      return true;
    }
    const incoming = decideIncoming(changes, snap.fileStamp?.sha256, snap.dirty, file.stamp?.sha256);
    if (incoming.action === "legacy" || incoming.action === "adopt") return false;
    const source = loaded.source ?? (await loadSource(snap.book.id).catch(() => null));
    if (incoming.action === "conflict") {
      await show(fromSnapshot(p, snap, source, {
        savedPath: file.path,
        conflict: { kind: "changed", path: file.path, other: { book: loaded.book, source: loaded.source, stamp: file.stamp ?? null }, journal: null },
      }));
      return true;
    }
    const session = fromSnapshot(p, snap, source, { savedPath: file.path });
    await show(session);
    session.applyIncoming(incoming.edits, changes.device, { stamp: file.stamp ?? null, progress: loaded.book.progress ?? null });
    return true;
  }

  async function load(file: PickedFile) {
    const p = platform;
    if (!p) return;
    view = { name: "working", file: file.name, stage: null };
    try {
      const kind = kindOf(file);
      if (LESE_APP && kind !== "hbook") {
        throw new Error("Die Lese-App öffnet nur Sprechbuch-Dateien (.hbook). EPUB und PDF werden in der Desktop-App aufbereitet.");
      }
      if (kind === "hbook") {
        await openBookFile(p, file, undefined);
      } else if (kind === "json") {
        const loaded = await openJson(new TextDecoder().decode(file.bytes));
        await show(new BookSession({ platform: p, book: loaded.book, source: loaded.source, savedPath: null, dirty: true }));
      } else {
        const loaded = await importSource(file.name, file.bytes, (stage) => {
          if (view.name === "working") view.stage = stage;
        });
        await show(new BookSession({ platform: p, book: loaded.book, source: loaded.source, savedPath: null, dirty: true, sourcePath: file.path ?? null }));
      }
    } catch (err) {
      view = { name: "error", message: errorText(err) };
    }
  }

  async function openPath(path: string) {
    const files = platform?.files;
    if (!files) return;
    try {
      await load(await files.read(path));
    } catch (err) {
      view = { name: "error", message: errorText(err) };
    }
  }

  /** Das gemeinfreie Beispiel („Effi Briest“, erstes Kapitel), das mit der App ausgeliefert wird */
  async function openExample() {
    if (!platform) return;
    try {
      const res = await fetch(new URL("beispiel/effi-briest-kapitel-1.hbook", document.baseURI));
      if (!res.ok) throw new Error(`Das Beispiel ließ sich nicht laden (${res.status}).`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      await load({ name: "effi-briest-kapitel-1.hbook", bytes, stamp: { size: bytes.length, modifiedMs: Date.now(), sha256: await sha256Hex(bytes) } });
    } catch (err) {
      view = { name: "error", message: errorText(err) };
    }
  }

  async function pick() {
    if (!platform) return;
    try {
      const file = await platform.pickFile("any");
      if (file) await load(file);
    } catch (err) {
      view = { name: "error", message: errorText(err) };
    }
  }

  async function openRecent(id: string) {
    const p = platform;
    const snap = await loadSnapshot(id);
    if (!p || !snap) return;
    // Desktop: Die Datei könnte inzwischen woanders weiterbearbeitet worden sein
    if (p.files && snap.savedPath && isAbsolutePath(snap.savedPath)) {
      view = { name: "working", file: snap.book.meta.title, stage: null };
      try {
        await openBookFile(p, await p.files.read(snap.savedPath), snap, true);
      } catch (err) {
        if (!(err instanceof FileMissingError)) {
          view = { name: "error", message: errorText(err) };
          return;
        }
        const source = await loadSource(id).catch(() => null);
        await show(fromSnapshot(p, snap, source, { conflict: { kind: "missing", path: snap.savedPath, journal: null } }));
      }
      return;
    }
    const source = await loadSource(id).catch(() => null);
    // Ältere Einträge ohne vollständigen Pfad: ohne Dateibezug öffnen, Speichern fragt nach dem Ort
    const legacy = !!p.files && !!snap.savedPath && !isAbsolutePath(snap.savedPath);
    await show(fromSnapshot(p, snap, source, legacy ? { savedPath: null, dirty: true } : {}));
  }

  async function close() {
    if (view.name === "book") await view.session.close();
    view = { name: "start" };
  }

  /** Vor dem Schließen des Fensters: speichern, was automatisch geht; sonst nachfragen */
  async function confirmClose(): Promise<boolean> {
    if (view.name !== "book" || !platform?.files) return true;
    const session = view.session;
    await session.autosave();
    if (!session.dirty) {
      await session.close();
      return true;
    }
    const where = session.savedPath ? "noch nicht in der Datei" : "noch in keiner .hbook-Datei";
    const answer = await platform.files.ask(
      `„${session.book.meta.title}“ hat Änderungen, die ${where} stehen. Sie bleiben unter „Zuletzt bearbeitet“ erhalten.\n\nJetzt speichern?`,
      { yes: "Speichern", no: "Nicht speichern", cancel: "Abbrechen" },
    );
    if (answer === "cancel") return false;
    if (answer === "yes" && !(await session.save())) return false;
    await session.close();
    return true;
  }
</script>

{#if view.name === "book" && platform}
  <Workspace session={view.session} {platform} onClose={close} />
{:else}
  <div class="shell">
    <header>
      <button class="ghost brand" onclick={() => (view = { name: "start" })}><span class="logo" aria-hidden="true">▍</span>Sprechbuch</button>
    </header>
    <main>
      {#if view.name === "start"}
        <Start onPick={pick} onDrop={load} onOpenRecent={openRecent} onExample={openExample} ready={platform !== null} {dragOver} />
      {:else if view.name === "working"}
        <ImportProgress file={view.file} stage={view.stage} />
      {:else if view.name === "error"}
        <div class="dialog panel" role="alert">
          <h2>Das hat nicht geklappt</h2>
          <p class="message">{view.message}</p>
          <button onclick={() => (view = { name: "start" })}>Zurück</button>
        </div>
      {/if}
    </main>
  </div>
{/if}

<style>
  .shell { min-height: 100vh; display: flex; flex-direction: column; }
  header { display: flex; align-items: center; padding: 0.5rem 1rem; height: 3.6rem; border-bottom: 1px solid var(--line); }
  .brand { font-weight: 700; font-size: 1.05rem; }
  .logo { color: var(--m0); margin-right: 0.35rem; }
  main { flex: 1; width: 100%; max-width: 1180px; margin: 0 auto; padding: 1.4rem 1.2rem 4rem; }
  .dialog { max-width: 38rem; margin: 3rem auto; padding: 1.5rem; display: grid; gap: 0.8rem; }
  .dialog p { margin: 0; }
  .message { white-space: pre-wrap; }
</style>
