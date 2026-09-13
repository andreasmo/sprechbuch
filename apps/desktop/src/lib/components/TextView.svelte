<script lang="ts" module>
  export interface TextHit {
    block: string;
    offset: number;
    x: number;
    y: number;
  }
  export interface TextSelection {
    block: string;
    start: number;
    end: number;
    x: number;
    y: number;
  }
</script>

<script lang="ts">
  import type { BookChapter } from "@sprechbuch/core";
  import { markVar, strongVar } from "../markers";
  import { renderBlock, type Piece } from "../render";
  import { settings } from "../store/settings.svelte";
  import type { BookSession, Position } from "../store/session.svelte";

  let {
    session,
    chapter,
    mode,
    blockIds,
    current = null,
    isRead,
    focusSpeech,
    onText,
    onPoint,
    onPipe,
    onSentence,
    onSelect,
  }: {
    session: BookSession;
    chapter: BookChapter;
    mode: "edit" | "record" | "review";
    /** Nur diese Absätze zeigen (Prüf-Kontext) */
    blockIds?: string[];
    current?: Position | null;
    isRead?: (block: string, sentence: number) => boolean;
    /** Diese Rede hervorheben, alle anderen abdimmen */
    focusSpeech?: string;
    onText?: (hit: TextHit, alt: boolean) => void;
    onPoint?: (id: string, x: number, y: number) => void;
    onPipe?: (block: string, sentence: number) => void;
    onSentence?: (pos: Position) => void;
    onSelect?: (sel: TextSelection | null) => void;
  } = $props();

  let root: HTMLElement;

  const blocks = $derived(blockIds ? chapter.blocks.filter((b) => blockIds.includes(b.id)) : chapter.blocks);
  const cast = $derived(session.lookup.cast);

  /** DOM-Stelle → Offset im Absatztext */
  function hitFromNode(node: Node | null, nodeOffset: number): { block: string; offset: number } | null {
    const el = node?.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element | null);
    const para = el?.closest<HTMLElement>("[data-block]");
    const piece = el?.closest<HTMLElement>("[data-start]");
    if (!para || !piece) return null;
    const start = Number(piece.dataset.start);
    const end = Number(piece.dataset.end);
    if (el?.closest(".badge")) return { block: para.dataset.block!, offset: start };
    const off = node?.nodeType === Node.TEXT_NODE ? nodeOffset : 0;
    return { block: para.dataset.block!, offset: Math.min(end, start + off) };
  }

  function caretAt(x: number, y: number): { node: Node; offset: number } | null {
    const d = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    const pos = d.caretPositionFromPoint?.(x, y);
    if (pos) return { node: pos.offsetNode, offset: pos.offset };
    const r = d.caretRangeFromPoint?.(x, y);
    return r ? { node: r.startContainer, offset: r.startOffset } : null;
  }

  function onClick(ev: MouseEvent) {
    const target = ev.target as HTMLElement;
    const point = target.closest<HTMLElement>("[data-point]");
    if (point) {
      onPoint?.(point.dataset.point!, ev.clientX, ev.clientY);
      return;
    }
    const pipe = target.closest<HTMLElement>("button.pipe");
    if (pipe) {
      onPipe?.(pipe.dataset.block!, Number(pipe.dataset.s));
      return;
    }
    if (mode === "record") {
      const s = target.closest<HTMLElement>(".s");
      const para = target.closest<HTMLElement>("[data-block]");
      if (s && para) onSentence?.({ block: para.dataset.block!, sentence: Number(s.dataset.s) });
      return;
    }
    if (!window.getSelection()?.isCollapsed) return; // Textauswahl – das erledigt onMouseUp
    const icon = target.closest<HTMLElement>("[data-icon-at]");
    const caret = icon ? null : caretAt(ev.clientX, ev.clientY);
    const hit = icon
      ? { block: icon.closest<HTMLElement>("[data-block]")!.dataset.block!, offset: Number(icon.dataset.iconAt) }
      : caret ? hitFromNode(caret.node, caret.offset) : null;
    if (hit) onText?.({ ...hit, x: ev.clientX, y: ev.clientY }, ev.altKey);
  }

  function onMouseUp() {
    if (mode !== "edit" || !onSelect) return;
    // Auswahl erst nach dem Browser-Update auswerten
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount || !root.contains(sel.anchorNode)) {
        onSelect(null);
        return;
      }
      const a = hitFromNode(sel.anchorNode, sel.anchorOffset);
      const b = hitFromNode(sel.focusNode, sel.focusOffset);
      if (!a || !b || a.block !== b.block) {
        onSelect(null);
        return;
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      onSelect({ block: a.block, start: Math.min(a.offset, b.offset), end: Math.max(a.offset, b.offset), x: rect.left + rect.width / 2, y: rect.top });
    }, 0);
  }

  const isCur = (block: string, s: number | null) => s !== null && current?.block === block && current.sentence === s;
  const icon = (t: "retake" | "note" | "bookmark") => (t === "retake" ? "⟲" : t === "note" ? "✎" : "★");
</script>

{#snippet pieces(list: Piece[])}
  {#each list as p, i (i)}
    {#if p.kind === "point"}
      <span class="pt" class:long={p.long} data-point={p.id} title={p.mark === "breath" ? "Atemzeichen" : p.long ? "lange Pause" : "Pause"}
        >{p.mark === "breath" ? "✓" : p.long ? "//" : "/"}</span
      >
    {:else}
      {#each p.starts ?? [] as s (s.id)}<span class="icon {s.type}" data-icon-at={p.start} title={s.text ?? ""}>{icon(s.type)}</span>{/each}<span
        data-start={p.start}
        data-end={p.end}
        class="t"
        class:it={p.italic}
        class:bd={p.bold}
        class:emph={p.emphasis}
        class:retake={p.retake}
        class:note={p.note}
        class:q2={p.quote}
      >{#if p.speech}<mark
            class="sp"
            class:weak={p.speech.weak}
            class:dim={focusSpeech !== undefined && focusSpeech !== p.speech.id}
            class:focus={focusSpeech === p.speech.id}
            style="--mark: {markVar(p.speech.slot)}; --strong: {strongVar(p.speech.slot)}"
            title={p.speech.speaker ? (cast.get(p.speech.speaker)?.name ?? p.speech.speaker) : "nicht zugeordnet"}
            >{#if p.speech.badge}<span class="badge">{p.speech.badge}</span>{/if}{p.text}</mark
          >{:else}{p.text}{/if}</span
      >
    {/if}
  {/each}
{/snippet}

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="textview"
  data-mode={mode}
  data-speech={settings.speech}
  class:no-badges={!settings.badges}
  class:focus-mode={mode === "record" && settings.focus}
  style="--fs: {settings.fontSize}px; --lh: {settings.lineHeight}; --colw: {settings.columnWidth}rem"
  bind:this={root}
  onclick={onClick}
  onmouseup={onMouseUp}
>
  {#each blocks as block (block.id)}
    {@const segs = renderBlock(session.book, chapter.id, block, session.lookup.byBlock.get(block.id) ?? [], cast)}
    {#if block.type === "h1"}
      <h2 class="h1" data-block={block.id}>{@render pieces(segs[0]?.pieces ?? [])}</h2>
    {:else if block.type === "h2"}
      <h3 class="h2" data-block={block.id}>{@render pieces(segs[0]?.pieces ?? [])}</h3>
    {:else}
      <p data-block={block.id} class:quote={block.type === "quote"} class:verse={block.type === "verse"}>
        {#each segs as seg, si (si)}
          {#if seg.sentence !== null}
            <span
              class="s"
              class:cur={isCur(block.id, seg.sentence)}
              class:read={mode === "record" && settings.dimRead && isRead?.(block.id, seg.sentence)}
              data-s={seg.sentence}>{@render pieces(seg.pieces)}</span
            >{#if settings.pipes}{#if mode === "edit" && seg.sentence < block.sentences.length - 1}<button
                  type="button"
                  class="pipe"
                  tabindex="-1"
                  data-block={block.id}
                  data-s={seg.sentence}
                  title="Satzgrenze entfernen">&nbsp;|</button
                >{:else}<span class="pipe" aria-hidden="true">&nbsp;|</span>{/if}{/if}
          {:else}{@render pieces(seg.pieces)}{/if}
        {/each}{#if settings.pipes}<span class="ppipe" aria-hidden="true">&nbsp;‖</span>{/if}
      </p>
    {/if}
  {/each}
</div>

<style>
  .textview {
    max-width: var(--colw);
    margin: 0 auto;
    font-family: var(--read);
    font-size: var(--fs);
    line-height: var(--lh);
    text-align: left;
    hyphens: none;
    -webkit-hyphens: none;
    overflow-wrap: break-word;
  }
  .h1 { font-size: 1.45em; margin: 1.6em 0 0.7em; line-height: 1.25; }
  .h2 { font-size: 1.1em; margin: 0 0 1em; color: var(--muted); font-weight: 600; }
  p { margin: 0 0 0.95em; }
  p.quote { margin-left: 1.4em; padding-left: 0.8em; border-left: 2px solid var(--line); }
  p.verse { white-space: pre-wrap; }

  [data-mode="edit"] { cursor: text; }
  [data-mode="record"] .s { cursor: pointer; border-radius: 0.2em; }
  .s.cur { background: var(--cur); outline: 0.12em solid var(--curline); outline-offset: 0.12em; }
  .s.read { opacity: 0.5; }
  .focus-mode .s:not(.cur) { opacity: 0.3; }

  .it { font-style: italic; }
  .bd { font-weight: 700; }
  .emph { text-decoration: underline; text-decoration-thickness: 0.12em; text-underline-offset: 0.18em; font-weight: 600; }
  .retake { text-decoration: underline wavy var(--danger); text-decoration-thickness: 1px; text-underline-offset: 0.3em; }
  .note { border-bottom: 1px dotted var(--accent); }
  .icon { font: 700 0.62em/1 var(--ui); vertical-align: 0.5em; margin: 0 0.15em; cursor: pointer; user-select: none; }
  .icon.retake { color: var(--danger); text-decoration: none; }
  .icon.note { color: var(--accent); }
  .icon.bookmark { color: var(--warn); }
  .pt { font: 700 0.8em/1 var(--ui); color: var(--accent); margin: 0 0.12em; cursor: pointer; user-select: none; }
  .pt.long { letter-spacing: -0.1em; }

  .pipe, .ppipe { color: var(--muted); font: inherit; font-weight: 300; opacity: 0.75; user-select: none; }
  button.pipe { border: 0; background: none; padding: 0; margin: 0; cursor: pointer; border-radius: 0.2em; }
  button.pipe:hover { color: var(--danger); background: color-mix(in srgb, var(--danger) 12%, transparent); opacity: 1; }
  .ppipe { opacity: 0.45; }

  [data-speech="underline"] :global(mark.sp) { background: none; text-decoration: underline 0.12em var(--strong); text-underline-offset: 0.22em; padding: 0; margin: 0; }
  [data-speech="off"] :global(mark.sp) { background: none; padding: 0; margin: 0; }
  [data-speech="off"] :global(.badge), .no-badges :global(.badge) { display: none; }
  :global(mark.sp.dim) { opacity: 0.45; }
  :global(mark.sp.focus) { box-shadow: 0 0 0 2px var(--accent); }
</style>
