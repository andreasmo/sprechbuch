<script lang="ts">
  import type { ImportStage } from "@sprechbuch/core";
  import { onMount } from "svelte";
  import BookView from "./lib/components/BookView.svelte";
  import ImportProgress from "./lib/components/ImportProgress.svelte";
  import Welcome from "./lib/components/Welcome.svelte";
  import { detectPlatform, type PickedFile, type Platform } from "./lib/platform";
  import { importSource, openHbook, type LoadedBook } from "./lib/worker/protocol";

  type View =
    | { name: "welcome" }
    | { name: "working"; file: string; stage: ImportStage | null }
    | { name: "book"; loaded: LoadedBook; savedPath: string | null; fromHbook: boolean }
    | { name: "error"; message: string };

  let platform = $state<Platform | null>(null);
  let view = $state<View>({ name: "welcome" });
  let saving = $state(false);

  onMount(async () => {
    platform = await detectPlatform();
  });

  const isHbook = (f: PickedFile) => f.name.toLowerCase().endsWith(".hbook");
  const hbookName = (name: string) => name.replace(/\.[^.]+$/, "") + ".hbook";

  async function load(file: PickedFile) {
    view = { name: "working", file: file.name, stage: null };
    try {
      if (isHbook(file)) {
        const loaded = await openHbook(file.name, file.bytes);
        view = { name: "book", loaded, savedPath: file.path ?? file.name, fromHbook: true };
      } else {
        const loaded = await importSource(file.name, file.bytes, (stage) => {
          if (view.name === "working") view.stage = stage;
        });
        view = { name: "book", loaded, savedPath: null, fromHbook: false };
      }
    } catch (err) {
      view = { name: "error", message: err instanceof Error ? err.message : String(err) };
    }
  }

  async function pick(kind: "source" | "hbook") {
    if (!platform) return;
    try {
      const file = await platform.pickFile(kind);
      if (file) await load(file);
    } catch (err) {
      view = { name: "error", message: err instanceof Error ? err.message : String(err) };
    }
  }

  async function save() {
    if (!platform || view.name !== "book") return;
    const current = view;
    saving = true;
    try {
      const suggested = hbookName(current.loaded.book.meta.source.fileName);
      const path = await platform.saveHbook(current.loaded.hbook, suggested);
      if (path) current.savedPath = path;
    } catch (err) {
      view = { name: "error", message: `Speichern fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}` };
    } finally {
      saving = false;
    }
  }
</script>

<div class="shell">
  <header>
    <button class="brand" onclick={() => (view = { name: "welcome" })} aria-label="Zur Startseite">
      <span class="logo" aria-hidden="true">▍</span>Sprechbuch
    </button>
    <span class="grow"></span>
    {#if view.name === "book"}
      <span class="status muted">
        {#if view.savedPath}Gespeichert: {view.savedPath}{:else}Noch nicht gespeichert{/if}
      </span>
      <button onclick={() => pick("source")}>Anderes Buch …</button>
      <button class="primary" onclick={save} disabled={saving}>
        {saving ? "Speichere …" : view.savedPath ? "Speichern unter …" : "Als .hbook speichern"}
      </button>
    {/if}
  </header>

  <main>
    {#if view.name === "welcome"}
      <Welcome onPick={pick} onDrop={load} ready={platform !== null} />
    {:else if view.name === "working"}
      <ImportProgress file={view.file} stage={view.stage} />
    {:else if view.name === "book"}
      <BookView loaded={view.loaded} />
    {:else}
      <div class="error panel" role="alert">
        <h2>Das hat nicht geklappt</h2>
        <p>{view.message}</p>
        <button onclick={() => (view = { name: "welcome" })}>Zurück</button>
      </div>
    {/if}
  </main>
</div>

<style>
  .shell { min-height: 100vh; display: flex; flex-direction: column; }
  header {
    position: sticky; top: 0; z-index: 10;
    display: flex; align-items: center; gap: 0.6rem;
    padding: 0.6rem 1.2rem;
    background: var(--bg);
    border-bottom: 1px solid var(--line);
  }
  .brand { border: 0; background: none; padding: 0.2rem 0; font-weight: 700; font-size: 1.05rem; letter-spacing: 0.01em; }
  .logo { color: var(--m0, #fff27a); text-shadow: 0 0 0 var(--ms0); margin-right: 0.35rem; }
  .grow { flex: 1; }
  .status { font-size: 0.85rem; max-width: 40vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  main { flex: 1; width: 100%; max-width: 1180px; margin: 0 auto; padding: 1.6rem 1.2rem 4rem; }
  .error { max-width: 36rem; margin: 3rem auto; padding: 1.5rem; }
  .error p { white-space: pre-wrap; }
</style>
