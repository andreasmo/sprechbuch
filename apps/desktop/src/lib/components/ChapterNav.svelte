<script lang="ts">
  import type { Book } from "@sprechbuch/core";

  let { book, index, onChange }: { book: Book; index: number; onChange: (i: number) => void } = $props();
  const last = $derived(book.chapters.length - 1);
</script>

<div class="nav">
  <button class="ghost" disabled={index <= 0} onclick={() => onChange(index - 1)} title="Vorheriges Kapitel ([)" aria-label="Vorheriges Kapitel">‹</button>
  <select value={index} onchange={(e) => onChange(Number(e.currentTarget.value))} aria-label="Kapitel">
    {#each book.chapters as c, i (c.id)}
      <option value={i}>{i + 1}. {c.title}</option>
    {/each}
  </select>
  <button class="ghost" disabled={index >= last} onclick={() => onChange(index + 1)} title="Nächstes Kapitel (])" aria-label="Nächstes Kapitel">›</button>
</div>

<style>
  .nav { display: flex; align-items: center; gap: 0.2rem; min-width: 0; }
  select { min-width: 8rem; max-width: 22rem; }
</style>
