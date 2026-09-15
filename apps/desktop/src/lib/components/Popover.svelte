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

  const MARGIN = 8;
  let el: HTMLElement;
  let content: HTMLElement;
  let pos = $state({ left: 0, top: 0, maxHeight: 0 });

  /**
   * Im Fenster halten: bevorzugt unter dem Klickpunkt, sonst darüber. Passt das Menü an keiner der beiden
   * Stellen ganz hin (Tablet, lange Figurenliste), liegt es vollständig im Fenster – notfalls über dem Klickpunkt –,
   * statt abgeschnitten unten weiterzuscrollen.
   */
  function place() {
    if (!el || !content) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const chrome = el.offsetHeight - el.clientHeight + parseFloat(getComputedStyle(el).paddingTop) * 2;
    const natural = content.offsetHeight + chrome;
    const w = el.offsetWidth;
    const left = Math.min(Math.max(MARGIN, x - w / 2), vw - w - MARGIN);
    const below = y + 18;
    const spaceBelow = vh - below - MARGIN;
    const spaceAbove = y - 12 - MARGIN;
    if (natural <= spaceBelow) pos = { left, top: below, maxHeight: spaceBelow };
    else if (natural <= spaceAbove) pos = { left, top: y - 12 - natural, maxHeight: spaceAbove };
    else {
      const maxHeight = vh - 2 * MARGIN;
      pos = { left, top: Math.max(MARGIN, Math.min(below, vh - MARGIN - Math.min(natural, maxHeight))), maxHeight };
    }
  }

  // Neu ausrichten, wenn sich der Inhalt ändert (Suche in der Figurenliste, nächster Schritt im Menü)
  $effect(() => {
    void [x, y];
    place();
    const observer = new ResizeObserver(() => place());
    observer.observe(content);
    return () => observer.disconnect();
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

<svelte:window onkeydown={onWindowKey} onpointerdown={onWindowPointer} onresize={place} />

<div
  class="popover panel"
  role="dialog"
  bind:this={el}
  style="left: {pos.left}px; top: {pos.top}px; width: min({width}rem, 94vw); {pos.maxHeight ? `max-height: ${pos.maxHeight}px` : ''}"
>
  <div bind:this={content}>{@render children()}</div>
</div>

<style>
  .popover {
    position: fixed;
    z-index: 50;
    padding: 0.7rem;
    max-height: calc(100vh - 16px);
    overflow: auto;
    overscroll-behavior: contain;
    font-family: var(--ui);
    font-size: 0.92rem;
    line-height: 1.4;
  }
</style>
