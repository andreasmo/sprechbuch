<script lang="ts">
  import type { Book, ImportStage } from "@sprechbuch/core";
  import { onMount } from "svelte";
  import ImportProgress from "./lib/components/ImportProgress.svelte";
  import Start from "./lib/components/Start.svelte";
  import Workspace from "./lib/components/Workspace.svelte";
  import { detectPlatform, type PickedFile, type Platform } from "./lib/platform";
  import { loadSnapshot, loadSource, type Snapshot } from "./lib/store/persist";
  import { BookSession } from "./lib/store/session.svelte";
  import "./lib/store/settings.svelte";
  import { importSource, openHbook, openJson, type LoadedBook } from "./lib/worker/protocol";

  type View =
    | { name: "start" }
    | { name: "working"; file: string; stage: ImportStage | null }
    | { name: "conflict"; loaded: LoadedBook; path: string | null; snapshot: Snapshot }
    | { name: "book"; session: BookSession }
    | { name: "error"; message: string };

  let platform = $state<Platform | null>(null);
  let view = $state<View>({ name: "start" });

  onMount(async () => {
    platform = await detectPlatform();
  });

  function show(session: BookSession) {
    if (view.name === "book") view.session.dispose();
    view = { name: "book", session };
    window.scrollTo({ top: 0 });
  }

  const kindOf = (f: PickedFile) => {
    const ext = f.name.toLowerCase().split(".").pop();
    return ext === "hbook" ? "hbook" : ext === "json" ? "json" : "source";
  };

  async function load(file: PickedFile) {
    view = { name: "working", file: file.name, stage: null };
    try {
      const kind = kindOf(file);
      const loaded = kind === "hbook"
        ? await openHbook(file.bytes)
        : kind === "json"
          ? await openJson(new TextDecoder().decode(file.bytes))
          : await importSource(file.name, file.bytes, (stage) => {
            if (view.name === "working") view.stage = stage;
          });
      const savedPath = kind === "hbook" ? (file.path ?? file.name) : null;

      // Gibt es von genau diesem Buch ungespeicherte Änderungen, die neuer sind als die Datei?
      const snapshot = kind === "source" ? undefined : await loadSnapshot(loaded.book.id).catch(() => undefined);
      if (snapshot?.dirty && snapshot.book.meta.modifiedAt > loaded.book.meta.modifiedAt) {
        view = { name: "conflict", loaded, path: savedPath, snapshot };
        return;
      }
      show(new BookSession({ book: loaded.book, source: loaded.source, savedPath, dirty: kind !== "hbook" }));
    } catch (err) {
      view = { name: "error", message: err instanceof Error ? err.message : String(err) };
    }
  }

  async function pick() {
    if (!platform) return;
    try {
      const file = await platform.pickFile("any");
      if (file) await load(file);
    } catch (err) {
      view = { name: "error", message: err instanceof Error ? err.message : String(err) };
    }
  }

  async function openRecent(id: string) {
    const snap = await loadSnapshot(id);
    if (!snap) return;
    const source = await loadSource(id).catch(() => null);
    show(new BookSession({ book: snap.book, source, savedPath: snap.savedPath, dirty: snap.dirty, persistSource: false }));
  }

  function resolveConflict(useSnapshot: boolean) {
    if (view.name !== "conflict") return;
    const { loaded, path, snapshot } = view;
    const book: Book = useSnapshot ? snapshot.book : loaded.book;
    show(new BookSession({ book, source: loaded.source, savedPath: path ?? snapshot.savedPath, dirty: useSnapshot }));
  }

  function close() {
    if (view.name === "book") view.session.dispose();
    view = { name: "start" };
  }

  const when = (iso: string) => new Date(iso).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
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
        <Start onPick={pick} onDrop={load} onOpenRecent={openRecent} ready={platform !== null} />
      {:else if view.name === "working"}
        <ImportProgress file={view.file} stage={view.stage} />
      {:else if view.name === "conflict"}
        <div class="dialog panel" role="alertdialog" aria-labelledby="conflict-title">
          <h2 id="conflict-title">Ungespeicherte Änderungen gefunden</h2>
          <p>
            Für „{view.loaded.book.meta.title}“ gibt es Änderungen vom <strong>{when(view.snapshot.updatedAt)}</strong>,
            die noch nicht in der Datei stehen (Datei zuletzt geändert: {when(view.loaded.book.meta.modifiedAt)}).
          </p>
          <div class="row">
            <button class="primary" onclick={() => resolveConflict(true)}>Mit meinen Änderungen weiterarbeiten</button>
            <button onclick={() => resolveConflict(false)}>Datei laden, Änderungen verwerfen</button>
          </div>
        </div>
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
  .row { display: flex; gap: 0.5rem; flex-wrap: wrap; }
</style>
