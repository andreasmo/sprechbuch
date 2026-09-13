<script lang="ts">
  import { slotOf } from "@sprechbuch/core";
  import { markVar, strongVar } from "../markers";
  import type { BookSession } from "../store/session.svelte";

  let { session, chapterId, current = null, onPick, autofocus = true }: {
    session: BookSession;
    chapterId: string;
    current?: string | null;
    onPick: (speaker: string) => void;
    autofocus?: boolean;
  } = $props();

  let query = $state("");
  let input: HTMLInputElement | undefined = $state();

  /** Figuren dieses Kapitels zuerst (nach Häufigkeit im Kapitel), dann alle anderen nach Redeanteil */
  const ordered = $derived.by(() => {
    const inChapter = new Map<string, number>();
    const chapter = session.book.chapters.find((c) => c.id === chapterId);
    for (const b of chapter?.blocks ?? []) {
      for (const a of session.lookup.byBlock.get(b.id) ?? []) {
        if (a.type === "speech" && a.speaker) inChapter.set(a.speaker, (inChapter.get(a.speaker) ?? 0) + 1);
      }
    }
    const lines = new Map(session.stats.cast.map((c) => [c.id, c.lines]));
    return [...session.book.cast].sort((a, b) =>
      (inChapter.get(b.id) ?? -1) - (inChapter.get(a.id) ?? -1) || (lines.get(b.id) ?? 0) - (lines.get(a.id) ?? 0));
  });

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ordered;
    return ordered.filter((c) => c.name.toLowerCase().includes(q) || c.aliases.some((a) => a.toLowerCase().includes(q)));
  });
  const exact = $derived(ordered.some((c) => c.name.toLowerCase() === query.trim().toLowerCase()));

  $effect(() => {
    if (autofocus) input?.focus();
  });

  function create() {
    const id = session.apply({ type: "addCast", name: query });
    if (id) onPick(id);
  }

  function onKey(ev: KeyboardEvent) {
    if (/^[1-9]$/.test(ev.key) && !query) {
      const c = filtered[Number(ev.key) - 1];
      if (c) {
        ev.preventDefault();
        onPick(c.id);
      }
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      if (filtered[0] && (exact || !query.trim() || filtered.length === 1)) onPick(filtered[0].id);
      else if (query.trim()) create();
    }
  }
</script>

<div class="picker">
  <input
    bind:this={input}
    bind:value={query}
    onkeydown={onKey}
    placeholder="Figur suchen oder neu anlegen …"
    aria-label="Figur suchen"
  />
  <ul role="listbox" aria-label="Figuren">
    {#each filtered.slice(0, 40) as c, i (c.id)}
      {@const slot = slotOf(session.book, chapterId, c.id, session.lookup.cast)}
      <li>
        <button
          type="button"
          class="ghost"
          class:active={c.id === current}
          role="option"
          aria-selected={c.id === current}
          onclick={() => onPick(c.id)}
        >
          <span class="key">{!query && i < 9 ? i + 1 : ""}</span>
          <span class="swatch" style="--mark: {markVar(slot)}; --strong: {strongVar(slot)}"></span>
          <span class="name">{c.name}</span>
          {#if c.voiceNote}<span class="muted note">{c.voiceNote}</span>{/if}
        </button>
      </li>
    {/each}
  </ul>
  {#if query.trim() && !exact}
    <button type="button" class="new" onclick={create}>+ Neue Figur „{query.trim()}“ anlegen</button>
  {/if}
</div>

<style>
  .picker { display: grid; gap: 0.4rem; }
  input { width: 100%; }
  ul { list-style: none; margin: 0; padding: 0; max-height: 15rem; overflow: auto; }
  li button {
    width: 100%;
    display: grid;
    grid-template-columns: 1rem auto 1fr auto;
    align-items: center;
    gap: 0.5rem;
    padding: 0.3rem 0.4rem;
    text-align: left;
    border-radius: 6px;
  }
  li button.active { background: color-mix(in srgb, var(--accent) 14%, transparent); }
  .key { font: 600 0.72rem/1 ui-monospace, Consolas, monospace; color: var(--muted); }
  .name { overflow: hidden; text-overflow: ellipsis; }
  .note { font-size: 0.78rem; max-width: 7rem; overflow: hidden; text-overflow: ellipsis; }
  .new { width: 100%; text-align: left; }
</style>
