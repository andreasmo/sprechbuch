<script lang="ts">
  import type { Ink } from "@sprechbuch/core";
  import { INK_WIDTH, inkPath } from "../ink";

  let { ink, label = "Handschriftliche Notiz" }: { ink: Ink; label?: string } = $props();

  let width = $state(0);
  const paths = $derived(ink.strokes.map(inkPath));
  /** Strichstärke skaliert mit, wird im schmalen Rand aber nie dünner als gut ein Pixel */
  const stroke = $derived(width ? Math.max(ink.w, (1.2 * INK_WIDTH) / width) : ink.w);
</script>

<span class="ink" bind:clientWidth={width}>
  <svg viewBox="0 0 {INK_WIDTH} {ink.h}" style="aspect-ratio: {INK_WIDTH} / {ink.h}" stroke-width={stroke} role="img" aria-label={label}>
    {#each paths as d, i (i)}<path {d} />{/each}
  </svg>
</span>

<style>
  .ink { display: block; width: 100%; line-height: 0; }
  svg { display: block; width: 100%; height: auto; overflow: visible; }
  path { fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; }
</style>
