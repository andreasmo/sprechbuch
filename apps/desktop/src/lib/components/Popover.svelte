<script lang="ts">
  import type { Snippet } from "svelte";

  let { x, y, onClose, children, width = 20 }: {
    x: number;
    y: number;
    onClose: () => void;
    children: Snippet;
    /** Breite in rem */
    width?: number;
  } = $props();

  let el: HTMLElement;
  let pos = $state({ left: 0, top: 0 });

  // Im Fenster halten: bevorzugt unter dem Klickpunkt, sonst darüber
  $effect(() => {
    const r = el.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(Math.max(margin, x - r.width / 2), window.innerWidth - r.width - margin);
    const below = y + 18;
    const top = below + r.height + margin > window.innerHeight ? Math.max(margin, y - r.height - 12) : below;
    pos = { left, top };
  });

  function onWindowKey(ev: KeyboardEvent) {
    if (ev.key === "Escape") {
      ev.stopPropagation();
      onClose();
    }
  }

  function onWindowPointer(ev: PointerEvent) {
    if (el && !el.contains(ev.target as Node)) onClose();
  }
</script>

<svelte:window onkeydown={onWindowKey} onpointerdown={onWindowPointer} />

<div class="popover panel" role="dialog" bind:this={el} style="left: {pos.left}px; top: {pos.top}px; width: min({width}rem, 94vw)">
  {@render children()}
</div>

<style>
  .popover {
    position: fixed;
    z-index: 50;
    padding: 0.7rem;
    max-height: min(32rem, 80vh);
    overflow: auto;
    font-family: var(--ui);
    font-size: 0.92rem;
    line-height: 1.4;
  }
</style>
