<script lang="ts">
  import { onMount, tick } from "svelte";
  import { rangeFor } from "../dom";
  import type { SearchHit } from "../find";
  import { isTyping } from "../labels";
  import type { Platform } from "../platform";
  import { sentenceAt } from "../render";
  import type { BookSession } from "../store/session.svelte";
  import { aiDialog } from "../store/ai.svelte";
  import { settings } from "../store/settings.svelte";
  import AiSettingsDialog from "./AiSettingsDialog.svelte";
  import Editor from "./Editor.svelte";
  import FileConflictPanel from "./FileConflictPanel.svelte";
  import Help from "./Help.svelte";
  import Overview from "./Overview.svelte";
  import Popover from "./Popover.svelte";
  import Recorder from "./Recorder.svelte";
  import Review from "./Review.svelte";
  import SearchBar from "./SearchBar.svelte";
  import ViewSettings from "./ViewSettings.svelte";

  let { session, platform, onClose }: { session: BookSession; platform: Platform; onClose: () => void } = $props();

  type Tab = "overview" | "edit" | "review" | "record";
  // Wer schon gelesen hat, landet wieder im Aufnahmemodus
  const initialTab = (): Tab => (session.book.progress ? "record" : "overview");
  let tab = $state<Tab>(initialTab());
  let menuOpen = $state(false);
  let settingsPop = $state<{ x: number; y: number } | null>(null);
  let helpOpen = $state(false);

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

  // Wurde die Datei von außen geändert (Cloud-Sync, anderes Gerät)? Beim Zurückkehren ins Fenster und regelmäßig prüfen
  const CHECK_MS = 10_000;
  onMount(() => {
    if (!platform.files) return;
    const check = () => void session.checkFile();
    const onVisible = () => document.visibilityState === "visible" && check();
    const timer = setInterval(() => document.visibilityState === "visible" && check(), CHECK_MS);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", onVisible);
    };
  });

  const status = $derived.by(() => {
    if (session.conflict) return { text: "⚠ Datei geändert", cls: "warn" };
    if (session.saving) return { text: "Speichere …", cls: "" };
    if (session.dirty) return session.autosaves ? { text: "Wird gespeichert …", cls: "" } : { text: "● Ungespeichert", cls: "warn" };
    return session.savedPath ? { text: "Gespeichert", cls: "" } : { text: "Nicht gespeichert", cls: "" };
  });

  /** Textstelle im Editor zeigen und kurz aufleuchten lassen */
  async function showInText(block: string, start?: number, end?: number) {
    const ref = session.lookup.blocks.get(block);
    if (!ref) return;
    chapterIndex = ref.chapterIndex;
    tab = "edit";
    await tick();
    const el = document.querySelector<HTMLElement>(`.editor [data-block="${block}"]`);
    const range = start !== undefined && el ? rangeFor(el.parentElement!, block, start, end ?? start + 1) : null;
    if (range) window.scrollBy({ top: range.getBoundingClientRect().top - window.innerHeight * 0.4 });
    else el?.scrollIntoView({ block: "center" });
    el?.animate([{ backgroundColor: "color-mix(in srgb, var(--accent) 22%, transparent)" }, { backgroundColor: "transparent" }], { duration: 1600 });
  }

  /** Aufnahmemodus an einer Textstelle fortsetzen */
  function recordAt(block: string, offset: number) {
    const ref = session.lookup.blocks.get(block);
    if (!ref) return;
    chapterIndex = ref.chapterIndex;
    session.setPosition({ block, sentence: sentenceAt(ref.block, offset) });
    tab = "record";
  }

  function jump(hit: SearchHit) {
    if (tab === "record") recordAt(hit.block, hit.start);
    else void showInText(hit.block, hit.start, hit.end);
  }

  function openSearch() {
    session.search.open = true;
    // Feld erneut fokussieren, auch wenn die Suche schon offen war
    void tick().then(() => document.querySelector<HTMLInputElement>(".search input")?.select());
  }

  function onKey(ev: KeyboardEvent) {
    const mod = ev.ctrlKey || ev.metaKey;
    const inField = isTyping(ev);
    if (!mod) {
      if (inField || ev.altKey) return;
      if (ev.key === "/") {
        ev.preventDefault();
        openSearch();
      } else if (ev.key === "?") {
        ev.preventDefault();
        helpOpen = true;
      }
      return;
    }
    const k = ev.key.toLowerCase();
    if (k === "s") {
      ev.preventDefault();
      void session.save(ev.shiftKey);
    } else if (k === "f") {
      ev.preventDefault();
      openSearch();
    } else if (k === "z" && !inField) {
      ev.preventDefault();
      if (ev.shiftKey) session.redo();
      else session.undo();
    } else if (k === "y" && !inField) {
      ev.preventDefault();
      session.redo();
    }
  }

  function toggleSettings(ev: MouseEvent) {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    settingsPop = settingsPop ? null : { x: r.left + r.width / 2, y: r.bottom - 12 };
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
    <button class="ghost icon" class:on={session.search.open} onclick={() => (session.search.open ? (session.search.open = false) : openSearch())}
      title="Im Buch suchen (Strg+F)" aria-label="Suchen" aria-expanded={session.search.open}>⌕</button>
    <button class="ghost icon aa" class:on={settingsPop !== null} onpointerdown={(e) => settingsPop && e.stopPropagation()} onclick={toggleSettings}
      title="Darstellung" aria-label="Darstellung" aria-expanded={settingsPop !== null}>Aa</button>
    <button class="ghost icon help" onclick={() => (helpOpen = true)} title="Tastenkürzel (?)" aria-label="Tastenkürzel">?</button>
    <span class="sep" aria-hidden="true"></span>
    <button class="ghost icon" disabled={!session.canUndo} onclick={() => session.undo()} title={session.canUndo ? `Rückgängig: ${session.undoLabel} (Strg+Z)` : "Nichts rückgängig zu machen"} aria-label="Rückgängig">↶</button>
    <button class="ghost icon" disabled={!session.canRedo} onclick={() => session.redo()} title={session.canRedo ? `Wiederholen: ${session.redoLabel} (Strg+Y)` : "Nichts zu wiederholen"} aria-label="Wiederholen">↷</button>
    <span class="state small" class:dirty={status.cls === "warn"} title={session.savedPath ?? ""}>{status.text}</span>
    <button class="primary" onclick={() => session.save()} disabled={session.saving} title="Speichern (Strg+S)">
      {session.saving ? "Speichere …" : platform.canOverwrite ? "Speichern" : "Herunterladen"}
    </button>
    <div class="menu">
      <button class="ghost icon" onclick={() => (menuOpen = !menuOpen)} aria-label="Weitere Aktionen" aria-expanded={menuOpen}>⋯</button>
      {#if menuOpen}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="menu-list panel" onclick={() => (menuOpen = false)}>
          {#if platform.canOverwrite}<button class="ghost" onclick={() => session.save(true)}>Speichern unter … <kbd>Strg+⇧+S</kbd></button>{/if}
          {#if platform.files}
            <label class="ghost toggle" title="Änderungen selbsttätig in die .hbook-Datei schreiben, sobald sie gespeichert wurde">
              <input type="checkbox" bind:checked={settings.autosaveFile} /> Automatisch speichern
            </label>
          {/if}
          <button class="ghost" onclick={() => (aiDialog.open = true)}>KI einrichten …</button>
          <button class="ghost" onclick={() => session.exportJson()}>Als JSON exportieren</button>
          <button class="ghost" onclick={onClose}>Schließen</button>
        </div>
      {/if}
    </div>
  </header>

  {#if session.conflict || session.mergeReport}
    <FileConflictPanel {session} />
  {/if}

  {#if session.search.open}
    <SearchBar {session} onJump={jump} />
  {/if}

  <main class:wide={tab === "record"}>
    {#if tab === "overview"}
      <Overview {session} onReview={() => (tab = "review")}
        onRecordAt={(r) => recordAt(r.block, r.start)} onShowInText={(r) => showInText(r.block, r.start, r.end)} />
    {:else if tab === "edit"}
      <Editor {session} bind:chapterIndex />
    {:else if tab === "review"}
      <Review {session} onShowInText={(block) => showInText(block)} />
    {:else}
      <Recorder {session} bind:chapterIndex />
    {/if}
  </main>

  {#if settingsPop}
    <Popover x={settingsPop.x} y={settingsPop.y} onClose={() => (settingsPop = null)} width={25}>
      <ViewSettings />
    </Popover>
  {/if}

  {#if aiDialog.open}
    <AiSettingsDialog {platform} onClose={() => (aiDialog.open = false)} />
  {/if}

  {#if helpOpen}
    <Help onClose={() => (helpOpen = false)} />
  {/if}

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
    display: flex; align-items: center; gap: 0.3rem;
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
  .icon { font-size: 1.15rem; padding: 0.25rem 0.55rem; min-width: 2.2rem; }
  .icon.aa { font: 600 0.95rem/1 var(--read); }
  .icon.on { color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); }
  .sep { width: 1px; height: 1.4rem; background: var(--line); margin: 0 0.2rem; }
  .state { color: var(--muted); margin: 0 0.4rem; white-space: nowrap; }
  .state.dirty { color: var(--warn); }
  .menu { position: relative; }
  .menu-list { position: absolute; right: 0; top: 2.4rem; display: grid; min-width: 14rem; padding: 0.3rem; z-index: 40; }
  .menu-list button { text-align: left; display: flex; justify-content: space-between; gap: 1rem; }
  .toggle { display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem 0.85rem; border-radius: 8px; cursor: pointer; white-space: nowrap; }
  .toggle:hover { background: color-mix(in srgb, var(--fg) 7%, transparent); }
  main { max-width: 1180px; margin: 0 auto; padding: 1.4rem 1.2rem 4rem; }
  /* Aufnehmen: breiter, damit im Seitenmodus eine Doppelseite passt */
  main.wide { max-width: 1760px; padding-top: 0.8rem; }
  .toast { position: fixed; left: 50%; bottom: 1.2rem; transform: translateX(-50%); z-index: 60; padding: 0.55rem 1rem; font-size: 0.9rem; max-width: 90vw; animation: pop 0.15s ease-out; }
  .toast.error { border-color: var(--danger); color: var(--danger); }
  @keyframes pop { from { opacity: 0; transform: translate(-50%, 0.4rem); } }
  @media (max-width: 1020px) {
    .book-title, .state { display: none; }
  }
  @media (max-width: 900px) {
    header { padding: 0.45rem 0.5rem; gap: 0.15rem; }
    nav { margin-left: 0.1rem; }
    .tab { padding: 0.35rem 0.45rem; }
    .icon { min-width: 1.9rem; padding: 0.2rem 0.35rem; }
    .sep, .help { display: none; }
  }
</style>
