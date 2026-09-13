<script lang="ts">
  import { isTyping } from "../labels";
  import type { Platform } from "../platform";
  import type { BookSession } from "../store/session.svelte";
  import Editor from "./Editor.svelte";
  import Overview from "./Overview.svelte";
  import Recorder from "./Recorder.svelte";
  import Review from "./Review.svelte";

  let { session, platform, onClose }: { session: BookSession; platform: Platform; onClose: () => void } = $props();

  type Tab = "overview" | "edit" | "review" | "record";
  // Wer schon gelesen hat, landet wieder im Aufnahmemodus
  const initialTab = (): Tab => (session.book.progress ? "record" : "overview");
  let tab = $state<Tab>(initialTab());
  let menuOpen = $state(false);

  // Kapitel wird zwischen Bearbeiten und Aufnehmen geteilt; Start bei der Leseposition
  const startChapter = () => {
    const block = session.position?.block;
    const ref = block ? session.lookup.blocks.get(block) : undefined;
    if (ref) return ref.chapterIndex;
    const firstWithSpeech = session.book.chapters.findIndex((c) =>
      c.blocks.some((b) => (session.lookup.byBlock.get(b.id) ?? []).some((a) => a.type === "speech")));
    return Math.max(0, firstWithSpeech);
  };
  let chapterIndex = $state(startChapter());

  function showInText(block: string) {
    const ref = session.lookup.blocks.get(block);
    if (!ref) return;
    chapterIndex = ref.chapterIndex;
    tab = "edit";
    setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-block="${block}"]`);
      el?.scrollIntoView({ block: "center" });
      el?.animate([{ backgroundColor: "color-mix(in srgb, var(--accent) 25%, transparent)" }, { backgroundColor: "transparent" }], { duration: 1600 });
    }, 50);
  }

  function onKey(ev: KeyboardEvent) {
    const mod = ev.ctrlKey || ev.metaKey;
    if (!mod) return;
    const k = ev.key.toLowerCase();
    const inField = isTyping(ev);
    if (k === "s") {
      ev.preventDefault();
      void session.save(platform, ev.shiftKey);
    } else if (k === "z" && !inField) {
      ev.preventDefault();
      if (ev.shiftKey) session.redo();
      else session.undo();
    } else if (k === "y" && !inField) {
      ev.preventDefault();
      session.redo();
    }
  }

  const TABS: [Tab, string][] = [["overview", "Übersicht"], ["edit", "Bearbeiten"], ["review", "Prüfen"], ["record", "Aufnehmen"]];
</script>

<svelte:window onkeydown={onKey} onbeforeunload={() => session.persistNow()} />

<div class="workspace">
  <header>
    <button class="ghost brand" onclick={onClose} title="Zur Startseite">
      <span class="logo" aria-hidden="true">▍</span><span class="book-title">{session.book.meta.title}</span>
    </button>
    <nav aria-label="Ansicht">
      {#each TABS as [key, label] (key)}
        <button class="tab ghost" class:active={tab === key} aria-current={tab === key ? "page" : undefined} onclick={() => (tab = key)}>
          {label}{#if key === "review" && session.queue.length}<span class="count">{session.queue.length}</span>{/if}
        </button>
      {/each}
    </nav>
    <span class="grow"></span>
    <button class="ghost icon" disabled={!session.canUndo} onclick={() => session.undo()} title={session.canUndo ? `Rückgängig: ${session.undoLabel} (Strg+Z)` : "Nichts rückgängig zu machen"} aria-label="Rückgängig">↶</button>
    <button class="ghost icon" disabled={!session.canRedo} onclick={() => session.redo()} title={session.canRedo ? `Wiederholen: ${session.redoLabel} (Strg+Y)` : "Nichts zu wiederholen"} aria-label="Wiederholen">↷</button>
    <span class="state small" class:dirty={session.dirty} title={session.savedPath ?? ""}>
      {session.dirty ? "● Ungespeichert" : session.savedPath ? "Gespeichert" : "Nicht gespeichert"}
    </span>
    <button class="primary" onclick={() => session.save(platform)} disabled={session.saving} title="Speichern (Strg+S)">
      {session.saving ? "Speichere …" : platform.canOverwrite ? "Speichern" : "Herunterladen"}
    </button>
    <div class="menu">
      <button class="ghost icon" onclick={() => (menuOpen = !menuOpen)} aria-label="Weitere Aktionen" aria-expanded={menuOpen}>⋯</button>
      {#if menuOpen}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="menu-list panel" onclick={() => (menuOpen = false)}>
          {#if platform.canOverwrite}<button class="ghost" onclick={() => session.save(platform, true)}>Speichern unter … <kbd>Strg+⇧+S</kbd></button>{/if}
          <button class="ghost" onclick={() => session.exportJson(platform)}>Als JSON exportieren</button>
          <button class="ghost" onclick={onClose}>Schließen</button>
        </div>
      {/if}
    </div>
  </header>

  <main class:wide={tab === "record"}>
    {#if tab === "overview"}
      <Overview {session} onReview={() => (tab = "review")} />
    {:else if tab === "edit"}
      <Editor {session} bind:chapterIndex />
    {:else if tab === "review"}
      <Review {session} onShowInText={showInText} />
    {:else}
      <Recorder {session} bind:chapterIndex />
    {/if}
  </main>

  {#if session.toast}
    {#key session.toast.id}
      <div class="toast panel" class:error={session.toast.kind === "error"} role="status">{session.toast.text}</div>
    {/key}
  {/if}
</div>

<style>
  .workspace { min-height: 100vh; }
  header {
    position: sticky; top: 0; z-index: 30;
    display: flex; align-items: center; gap: 0.35rem;
    padding: 0.45rem 1rem; height: 3.6rem;
    background: var(--bg); border-bottom: 1px solid var(--line);
  }
  .brand { display: flex; align-items: center; gap: 0.35rem; font-weight: 700; max-width: 18rem; padding-left: 0.3rem; }
  .logo { color: var(--m0); }
  .book-title { overflow: hidden; text-overflow: ellipsis; }
  nav { display: flex; gap: 0.15rem; margin-left: 0.6rem; }
  .tab { padding: 0.4rem 0.75rem; border-radius: 8px; color: var(--muted); }
  .tab.active { color: var(--fg); background: color-mix(in srgb, var(--fg) 8%, transparent); font-weight: 600; }
  .count { margin-left: 0.4rem; font-size: 0.72rem; font-weight: 700; background: var(--warn); color: var(--panel); border-radius: 99px; padding: 0.05rem 0.4rem; }
  .grow { flex: 1; }
  .icon { font-size: 1.15rem; padding: 0.25rem 0.55rem; }
  .state { color: var(--muted); margin: 0 0.4rem; white-space: nowrap; }
  .state.dirty { color: var(--warn); }
  .menu { position: relative; }
  .menu-list { position: absolute; right: 0; top: 2.4rem; display: grid; min-width: 14rem; padding: 0.3rem; z-index: 40; }
  .menu-list button { text-align: left; display: flex; justify-content: space-between; gap: 1rem; }
  main { max-width: 1180px; margin: 0 auto; padding: 1.4rem 1.2rem 4rem; }
  .toast { position: fixed; left: 50%; bottom: 1.2rem; transform: translateX(-50%); z-index: 60; padding: 0.55rem 1rem; font-size: 0.9rem; max-width: 90vw; animation: pop 0.15s ease-out; }
  .toast.error { border-color: var(--danger); color: var(--danger); }
  @keyframes pop { from { opacity: 0; transform: translate(-50%, 0.4rem); } }
  @media (max-width: 860px) {
    .book-title, .state { display: none; }
  }
</style>
