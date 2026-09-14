<script lang="ts">
  import { hitContext, type SearchHit } from "../find";
  import { fmt } from "../labels";
  import type { BookSession } from "../store/session.svelte";

  let { session, onJump }: { session: BookSession; onJump: (hit: SearchHit) => void } = $props();

  const search = $derived(session.search);
  const hits = $derived(search.result.hits);
  const SHOWN = 150;
  let input = $state<HTMLInputElement>();
  let list = $state<HTMLElement>();
  /** Trefferliste beim Tippen zeigen, beim Springen per Tastatur einklappen – sonst verdeckt sie die Fundstelle */
  let listOpen = $state(true);

  $effect(() => {
    if (search.open) input?.select();
  });

  // Aktuellen Treffer in der Liste sichtbar halten
  $effect(() => {
    const i = search.index;
    list?.querySelector(`[data-i="${i}"]`)?.scrollIntoView({ block: "nearest" });
  });

  function step(dir: 1 | -1) {
    const hit = search.step(dir);
    if (!hit) return;
    listOpen = false;
    onJump(hit);
  }

  function pick(hit: SearchHit) {
    search.select(hit);
    listOpen = false;
    onJump(hit);
  }

  function close() {
    search.open = false;
  }

  function onKey(ev: KeyboardEvent) {
    if (ev.key === "Enter") {
      ev.preventDefault();
      step(ev.shiftKey ? -1 : 1);
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      close();
    } else if (ev.key === "ArrowDown") {
      ev.preventDefault();
      step(1);
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      step(-1);
    }
  }

  const blockText = (hit: SearchHit) => session.lookup.blocks.get(hit.block)?.block.text ?? "";
</script>

<div class="search panel" role="search">
  <div class="row">
    <input
      bind:this={input}
      type="search"
      placeholder="Im Buch suchen …"
      aria-label="Im Buch suchen"
      value={search.query}
      oninput={(e) => { search.setQuery(e.currentTarget.value); listOpen = true; }}
      onkeydown={onKey}
    />
    <span class="count small muted tabular" aria-live="polite">
      {#if search.query.trim().length < 2}
        &nbsp;
      {:else if hits.length}
        {search.index >= 0 ? `${fmt(search.index + 1)} / ` : ""}{fmt(hits.length)}{search.result.truncated ? "+" : ""}
      {:else}
        keine Treffer
      {/if}
    </span>
    <button class="ghost icon" onclick={() => step(-1)} disabled={!hits.length} title="Vorheriger Treffer (⇧+Enter)" aria-label="Vorheriger Treffer">↑</button>
    <button class="ghost icon" onclick={() => step(1)} disabled={!hits.length} title="Nächster Treffer (Enter)" aria-label="Nächster Treffer">↓</button>
    <button class="ghost icon" onclick={() => (listOpen = !listOpen)} disabled={!hits.length} class:on={listOpen && hits.length > 0}
      title={listOpen ? "Trefferliste einklappen" : "Trefferliste zeigen"} aria-label="Trefferliste" aria-expanded={listOpen}>☰</button>
    <button class="ghost icon" onclick={close} title="Schließen (Esc)" aria-label="Suche schließen">✕</button>
  </div>
  {#if hits.length && listOpen}
    <ol class="hits" bind:this={list}>
      {#each hits.slice(0, SHOWN) as hit, i (i)}
        {@const c = hitContext(blockText(hit), hit.start, hit.end, 40)}
        <li data-i={i}>
          <button class="ghost" class:active={i === search.index} onclick={() => pick(hit)}>
            <span class="chap muted tabular">Kap. {hit.chapterIndex + 1}</span>
            <span class="ctx">{c.before}<mark>{c.match}</mark>{c.after}</span>
          </button>
        </li>
      {/each}
    </ol>
    {#if hits.length > SHOWN}<p class="small muted more">… und {fmt(hits.length - SHOWN)} weitere – mit Enter weiterspringen</p>{/if}
  {/if}
</div>

<style>
  .search {
    position: fixed; top: 3.9rem; right: 1rem; z-index: 45;
    width: min(30rem, calc(100vw - 2rem)); padding: 0.5rem;
    display: grid; gap: 0.4rem;
  }
  .row { display: flex; align-items: center; gap: 0.2rem; }
  input { flex: 1; min-width: 0; }
  .count { min-width: 5.5rem; text-align: right; padding: 0 0.3rem; white-space: nowrap; }
  .icon { padding: 0.25rem 0.5rem; }
  .icon.on { color: var(--accent); }
  .hits { list-style: none; margin: 0; padding: 0; max-height: min(22rem, 55vh); overflow: auto; display: grid; gap: 1px; }
  .hits button { width: 100%; text-align: left; white-space: normal; display: grid; grid-template-columns: 3.6rem 1fr; gap: 0.4rem; padding: 0.3rem 0.4rem; font-size: 0.85rem; line-height: 1.35; }
  .hits button.active { background: color-mix(in srgb, var(--accent) 14%, transparent); }
  .chap { font-size: 0.75rem; padding-top: 0.1rem; }
  .ctx { font-family: var(--read); }
  .ctx mark { background: color-mix(in srgb, var(--accent) 28%, transparent); color: inherit; border-radius: 0.15em; }
  .more { margin: 0; padding: 0 0.4rem; }
</style>
