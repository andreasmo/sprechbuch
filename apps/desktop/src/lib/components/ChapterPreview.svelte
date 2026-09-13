<script lang="ts">
  import type { Annotation, Book } from "@sprechbuch/core";
  import { markVar, strongVar } from "../markers";
  import { renderBlock } from "../render";

  let { book }: { book: Book } = $props();

  // Erstes Kapitel mit direkter Rede vorauswählen – Titelseiten sind langweilig
  const byBlock = $derived.by(() => {
    const m = new Map<string, Annotation[]>();
    for (const a of book.annotations) {
      const list = m.get(a.block);
      if (list) list.push(a);
      else m.set(a.block, [a]);
    }
    return m;
  });
  const firstWithSpeech = $derived(
    Math.max(0, book.chapters.findIndex((c) => c.blocks.some((b) => byBlock.get(b.id)?.some((a) => a.type === "speech")))),
  );
  let chosen = $state<number | null>(null);
  const index = $derived(chosen ?? firstWithSpeech);
  const chapter = $derived(book.chapters[index]);
  const cast = $derived(new Map(book.cast.map((c) => [c.id, c])));
  const castName = (id: string | null | undefined) => (id ? (cast.get(id)?.name ?? id) : "nicht zugeordnet");
</script>

<section class="panel preview">
  <header>
    <h2>Vorschau</h2>
    <select aria-label="Kapitel wählen" value={index} onchange={(e) => (chosen = Number(e.currentTarget.value))}>
      {#each book.chapters as c, i (c.id)}
        <option value={i}>{i + 1}. {c.title}</option>
      {/each}
    </select>
  </header>

  {#if chapter}
    <div class="text">
      {#each chapter.blocks as block (block.id)}
        {#if block.type === "h1"}
          <h3>{block.text}</h3>
        {:else if block.type === "h2"}
          <h4>{block.text}</h4>
        {:else}
          <p class:quote={block.type === "quote"}>
            {#each renderBlock(book, chapter.id, block, byBlock.get(block.id) ?? [], cast) as piece, i (i)}
              {#if piece.kind === "pipe"}<span class="pipe" aria-hidden="true">{piece.text}</span>
              {:else if piece.speaker !== undefined}<mark
                  class="sp"
                  class:weak={piece.weak}
                  class:q2={piece.quote}
                  style="--mark: {markVar(piece.slot)}; --strong: {strongVar(piece.slot)}"
                  title={castName(piece.speaker)}
                >{#if piece.badge}<span class="badge">{piece.badge}</span>{/if}{piece.text}</mark>
              {:else}<span class:q2={piece.quote}>{piece.text}</span>{/if}
            {/each}<span class="ppipe" aria-hidden="true"> ‖</span>
          </p>
        {/if}
      {/each}
    </div>
  {/if}
</section>

<style>
  .preview { padding: 1.1rem 1.2rem 1.6rem; }
  header { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; margin-bottom: 1rem; }
  h2 { font-size: 1rem; }
  select { flex: 1; min-width: 12rem; max-width: 30rem; }
  .text {
    max-width: 38rem; margin: 0 auto;
    font-family: var(--read); font-size: 1.2rem; line-height: 1.85;
    text-align: left; hyphens: none; -webkit-hyphens: none;
  }
  h3 { font-size: 1.5rem; margin: 1.6rem 0 0.8rem; }
  h4 { font-size: 1.15rem; margin: 0 0 1rem; color: var(--muted); font-weight: 600; }
  p { margin: 0 0 1em; }
  p.quote { margin-left: 1.4em; padding-left: 0.8em; border-left: 2px solid var(--line); }
</style>
