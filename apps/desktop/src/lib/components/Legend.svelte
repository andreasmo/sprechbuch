<script lang="ts">
  import { slotOf, type BookChapter } from "@sprechbuch/core";
  import { markVar, strongVar } from "../markers";
  import { chapterCast } from "../render";
  import type { BookSession } from "../store/session.svelte";

  let { session, chapter, keys = false, limit = 12 }: {
    session: BookSession;
    chapter: BookChapter;
    /** Ziffern 1–9 anzeigen (Aufnahmemodus) */
    keys?: boolean;
    limit?: number;
  } = $props();

  const entries = $derived(chapterCast(chapter, session.lookup.byBlock));
  const named = $derived(entries.filter((e) => e.id !== null));
  const unassigned = $derived(entries.find((e) => e.id === null)?.n ?? 0);
  let showAll = $state(false);

  function click(ev: MouseEvent, id: string) {
    if (ev.shiftKey) session.toggleMute(id);
    else session.toggleIsolate(id);
  }
</script>

<div class="legend" aria-label="Figuren in diesem Kapitel">
  {#each showAll ? named : named.slice(0, limit) as e, i (e.id)}
    {@const c = session.lookup.cast.get(e.id!)}
    {@const slot = slotOf(session.book, chapter.id, e.id, session.lookup.cast)}
    <button
      class="chip"
      class:on={session.isolate === e.id}
      class:off={session.muted.includes(e.id!)}
      aria-pressed={session.isolate === e.id}
      title={`${c?.name ?? e.id}${c?.voiceNote ? ` – ${c.voiceNote}` : ""}\n${keys && i < 9 ? `Taste ${i + 1} · ` : ""}Klick: isolieren · ⇧+Klick: abblenden`}
      onclick={(ev) => click(ev, e.id!)}
    >
      {#if keys && i < 9}<span class="key">{i + 1}</span>{/if}
      <span class="swatch" style="--mark: {markVar(slot)}; --strong: {strongVar(slot)}"></span>
      <span class="name">{c?.name ?? e.id}</span>
      <span class="muted tabular">{e.n}</span>
    </button>
  {/each}
  {#if named.length > limit}
    <button class="chip more" onclick={() => (showAll = !showAll)}>{showAll ? "weniger" : `+${named.length - limit}`}</button>
  {/if}
  {#if unassigned}
    <span class="chip static" title="Rede ohne Figur – im Tab „Prüfen“ zuordnen">
      <span class="swatch" style="--mark: {markVar(null)}; --strong: {strongVar(null)}"></span>ohne Figur <span class="muted tabular">{unassigned}</span>
    </span>
  {/if}
  {#if session.isolate !== null || session.muted.length}
    <button class="chip reset" onclick={() => session.clearIsolation()} title={keys ? "Taste 0" : ""}>alle zeigen</button>
  {/if}
</div>

<style>
  .legend { display: flex; gap: 0.3rem; flex-wrap: wrap; align-items: center; }
  .chip {
    display: inline-flex; align-items: center; gap: 0.35rem;
    border: 1px solid var(--line); border-radius: 99px; padding: 0.12rem 0.55rem 0.12rem 0.35rem;
    font-size: 0.82rem; background: var(--panel); line-height: 1.3;
  }
  .chip.on { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); font-weight: 600; }
  .chip.off { opacity: 0.45; }
  .chip.off .name { text-decoration: line-through; }
  .static { cursor: default; color: var(--muted); }
  .more, .reset { color: var(--accent); padding-left: 0.55rem; }
  .key { font: 700 0.68rem/1 ui-monospace, Consolas, monospace; color: var(--muted); min-width: 0.6rem; }
  .name { max-width: 12rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
