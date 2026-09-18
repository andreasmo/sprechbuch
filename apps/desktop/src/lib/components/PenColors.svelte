<script lang="ts">
  import { PEN_SLOTS, penSlot, type BookChapter } from "@sprechbuch/core";
  import { penName, penStyle } from "../markers";
  import { settings } from "../store/settings.svelte";
  import type { BookSession } from "../store/session.svelte";
  import Popover from "./Popover.svelte";

  let { session, chapter, all = true, editable = true }: {
    session: BookSession;
    /** Betonungen in diesem Kapitel zählen */
    chapter?: BookChapter;
    /** alle Farben zeigen; sonst nur die im Kapitel benutzten und die gewählte (Legende beim Aufnehmen) */
    all?: boolean;
    /** Bedeutungen festlegen können */
    editable?: boolean;
  } = $props();

  const LINE_LABEL = { double: "doppelt", wavy: "gewellt", dotted: "gepunktet", dashed: "gestrichelt", solid: "kräftig" } as const;

  const labels = $derived(session.book.emphasisLabels ?? []);
  /** Betonungen je Farbe im Kapitel; Schlüssel -1 = schlicht */
  const counts = $derived.by(() => {
    const out = new Map<number, number>();
    if (!chapter) return out;
    for (const b of chapter.blocks) {
      for (const a of session.lookup.byBlock.get(b.id) ?? []) {
        if (a.type === "emphasis") {
          const k = penSlot(a.color) ?? -1;
          out.set(k, (out.get(k) ?? 0) + 1);
        }
      }
    }
    return out;
  });
  const shown = $derived(PEN_SLOTS.map((_, i) => i).filter((i) => all || counts.has(i) || settings.penColor === i));

  let editing = $state<{ x: number; y: number } | null>(null);
  const title = (i: number) => `${penName(i, labels)} · ${LINE_LABEL[PEN_SLOTS[i]!.line]} unterstrichen`;
</script>

<div class="pens" role="radiogroup" aria-label="Stiftfarbe für Betonungen">
  {#if all}
    <button class="chip" role="radio" aria-checked={settings.penColor === null} class:on={settings.penColor === null}
      onclick={() => (settings.penColor = null)} title="Schlichte Betonung – unterstrichen in Textfarbe">
      <span class="sample">schlicht</span>{#if counts.get(-1)}<span class="muted tabular">{counts.get(-1)}</span>{/if}
    </button>
  {/if}
  {#each shown as i (i)}
    <button class="chip" role="radio" aria-checked={settings.penColor === i} class:on={settings.penColor === i}
      onclick={() => (settings.penColor = i)} title={title(i)}>
      <span class="sample" style={penStyle(i)}>{labels[i]?.trim() || PEN_SLOTS[i]!.name}</span>{#if counts.get(i)}<span class="muted tabular">{counts.get(i)}</span>{/if}
    </button>
  {/each}
  {#if editable}
    <button class="ghost edit" onclick={(e) => (editing = { x: e.clientX, y: e.clientY })} title="Festlegen, was die Farben in diesem Buch bedeuten"
      aria-label="Bedeutung der Farben festlegen">✎</button>
  {/if}
</div>

{#if editing}
  <Popover x={editing.x} y={editing.y} onClose={() => (editing = null)} width={19}>
    <h4>Was bedeuten die Farben?</h4>
    <p class="muted small hint">Gilt für dieses Buch und steht in der Datei – z. B. „langsamer“, „leiser“, „Pause davor“.</p>
    <div class="labels">
      {#each PEN_SLOTS as p, i (i)}
        <label>
          <span class="sample" style={penStyle(i)}>{p.name}</span>
          <input value={labels[i] ?? ""} placeholder="Bedeutung" maxlength="40"
            onchange={(e) => session.apply({ type: "setEmphasisLabel", color: i, label: e.currentTarget.value })} />
        </label>
      {/each}
    </div>
  </Popover>
{/if}

<style>
  .pens { display: flex; gap: 0.3rem; flex-wrap: wrap; align-items: center; }
  .chip {
    display: inline-flex; align-items: center; gap: 0.35rem;
    border: 1px solid var(--line); border-radius: 99px; padding: 0.12rem 0.6rem 0.2rem;
    font-size: 0.82rem; background: var(--panel); line-height: 1.3;
  }
  .chip.on { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
  .edit { padding: 0.12rem 0.45rem; color: var(--muted); }
  .sample {
    font-weight: 600;
    display: inline-block; vertical-align: bottom; padding-bottom: 0.3em;
    max-width: 9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    text-decoration-line: underline;
    text-decoration-style: var(--pen-line, solid);
    text-decoration-color: var(--pen, currentColor);
    text-decoration-thickness: var(--pen-thick, 0.12em);
    text-underline-offset: 0.2em;
    text-decoration-skip-ink: none;
  }
  h4 { margin: 0.2rem 0 0.3rem; font-size: 0.92rem; }
  .hint { margin: 0 0 0.6rem; }
  .labels { display: grid; gap: 0.35rem; }
  label { display: grid; grid-template-columns: 5.5rem 1fr; align-items: center; gap: 0.5rem; }
  input { width: 100%; }
</style>
