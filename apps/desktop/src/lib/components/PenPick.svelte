<script lang="ts">
  import { PEN_SLOTS } from "@sprechbuch/core";
  import { penName, penStyle } from "../markers";

  /** Stiftfarbe wählen – schlicht oder eine der Farben, beschriftet mit ihrer Bedeutung im Buch */
  let { value, labels, onPick }: {
    /** gewählte Farbe; undefined = keine hervorheben */
    value?: number | null;
    labels: readonly string[] | undefined;
    onPick: (color: number | null) => void;
  } = $props();

  const options: (number | null)[] = [null, ...PEN_SLOTS.map((_, i) => i)];
</script>

<div class="pick" role="group" aria-label="Farbe der Betonung">
  {#each options as c (c ?? -1)}
    <button class="ghost" class:on={value === c} aria-pressed={value === undefined ? undefined : value === c}
      onclick={() => onPick(c)} title={penName(c, labels)}>
      <span class="sample" style={penStyle(c)}>{c === null ? "schlicht" : labels?.[c]?.trim() || PEN_SLOTS[c]!.name}</span>
    </button>
  {/each}
</div>

<style>
  .pick { display: flex; flex-wrap: wrap; gap: 0.15rem; }
  button { padding: 0.15rem 0.45rem 0.3rem; font-size: 0.85rem; }
  button.on { background: color-mix(in srgb, var(--accent) 12%, transparent); box-shadow: inset 0 0 0 1px var(--accent); }
  .sample {
    display: inline-block; max-width: 8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom;
    padding-bottom: 0.3em; font-weight: 600;
    text-decoration-line: underline;
    text-decoration-style: var(--pen-line, solid);
    text-decoration-color: var(--pen, currentColor);
    text-decoration-thickness: var(--pen-thick, 0.12em);
    text-underline-offset: 0.2em;
    text-decoration-skip-ink: none;
  }
</style>
