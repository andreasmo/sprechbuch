<script lang="ts">
  import { endOf, slotOf, startOf, type Annotation } from "@sprechbuch/core";
  import { MARK_LABEL, viaLabel } from "../labels";
  import { markVar, strongVar } from "../markers";
  import { snapSelection } from "../render";
  import type { BookSession } from "../store/session.svelte";
  import CastPicker from "./CastPicker.svelte";
  import ChapterNav from "./ChapterNav.svelte";
  import Popover from "./Popover.svelte";
  import TextView, { type TextHit, type TextSelection } from "./TextView.svelte";

  let { session, chapterIndex = $bindable(0) }: { session: BookSession; chapterIndex: number } = $props();

  type Pop =
    | { kind: "text"; hit: TextHit; alt: boolean; pickFor?: string }
    | { kind: "selection"; sel: TextSelection; step: "menu" | "speaker" | "note" }
    | { kind: "point"; id: string; x: number; y: number };

  let pop = $state<Pop | null>(null);
  let noteText = $state("");

  const chapter = $derived(session.book.chapters[Math.min(chapterIndex, session.book.chapters.length - 1)]!);

  /** Figuren dieses Kapitels für die Legende */
  const legend = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const b of chapter.blocks) {
      for (const a of session.lookup.byBlock.get(b.id) ?? []) {
        if (a.type === "speech" && a.speaker) counts.set(a.speaker, (counts.get(a.speaker) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
      .map(([id, n]) => ({ id, n, name: session.lookup.cast.get(id)?.name ?? id, slot: slotOf(session.book, chapter.id, id, session.lookup.cast) }));
  });

  const covering = (hit: TextHit): Annotation[] =>
    (session.lookup.byBlock.get(hit.block) ?? []).filter((a) =>
      a.type !== "pause" && a.type !== "breath" && startOf(a) <= hit.offset && hit.offset < Math.max(endOf(a), startOf(a) + 1));

  function close() {
    pop = null;
    window.getSelection()?.removeAllRanges();
  }

  function act(edit: Parameters<BookSession["apply"]>[0]) {
    const id = session.apply(edit);
    close();
    return id;
  }

  function onText(hit: TextHit, alt: boolean) {
    if (alt || covering(hit).length) pop = { kind: "text", hit, alt };
    else pop = null;
  }

  function onSelect(sel: TextSelection | null) {
    const text = sel ? session.lookup.blocks.get(sel.block)?.block.text : undefined;
    if (!sel || text === undefined) return;
    const [start, end] = snapSelection(text, sel.start, sel.end);
    if (end > start) {
      pop = { kind: "selection", sel: { ...sel, start, end }, step: "menu" };
      noteText = "";
    }
  }

  /** Für Rede: Anführungszeichen direkt an der Auswahl mitnehmen */
  function speechRange(sel: TextSelection): [number, number] {
    const text = session.lookup.blocks.get(sel.block)?.block.text ?? "";
    return snapSelection(text, sel.start, sel.end, true);
  }

  function onPipe(block: string, sentence: number) {
    session.apply({ type: "mergeSentences", block, index: sentence });
  }

  function splitHere(id: string, at: number) {
    const created = session.apply({ type: "splitSpeech", id, at, speaker: null });
    if (created && pop?.kind === "text") pop = { ...pop, pickFor: created };
  }

  const castName = (id: string | null) => (id ? (session.lookup.cast.get(id)?.name ?? id) : "nicht zugeordnet");
</script>

<div class="editor">
  <div class="toolbar">
    <ChapterNav book={session.book} index={chapterIndex} onChange={(i) => { chapterIndex = i; close(); }} />
    <div class="legend" aria-label="Figuren in diesem Kapitel">
      {#each legend.slice(0, 10) as f (f.id)}
        <span class="chip"><span class="swatch" style="--mark: {markVar(f.slot)}; --strong: {strongVar(f.slot)}"></span>{f.name} <span class="muted tabular">{f.n}</span></span>
      {/each}
    </div>
  </div>
  <p class="hint muted small">
    <strong>Rede anklicken</strong>: Sprecher ändern · <strong>Text markieren</strong>: Rede, Betonung, Notiz, Retake ·
    <kbd>Alt</kbd>+Klick: Satz teilen, Pause, Atem · <strong>|</strong> anklicken: Sätze verbinden
  </p>

  <div class="page panel">
    <TextView {session} {chapter} mode="edit" {onText} onSelect={onSelect} {onPipe} onPoint={(id, x, y) => (pop = { kind: "point", id, x, y })} />
  </div>
</div>

{#if pop?.kind === "text"}
  {@const hit = pop.hit}
  {@const anns = covering(hit)}
  {@const speech = anns.find((a) => a.type === "speech")}
  <Popover x={hit.x} y={hit.y} onClose={close} width={22}>
    {#if pop.pickFor}
      {@const pickFor = pop.pickFor}
      <h4>Neue Redepassage – wer spricht?</h4>
      <CastPicker {session} chapterId={chapter.id} onPick={(id) => act({ type: "setSpeaker", ids: [pickFor], speaker: id })} />
    {:else}
      {#if pop.alt}
        <h4>An dieser Stelle</h4>
        <div class="row">
          <button onclick={() => act({ type: "splitSentence", block: hit.block, at: hit.offset })}>Satz teilen</button>
          <button onclick={() => act({ type: "addMark", mark: { type: "pause", block: hit.block, at: hit.offset, length: "short" } })}>/ Pause</button>
          <button onclick={() => act({ type: "addMark", mark: { type: "pause", block: hit.block, at: hit.offset, length: "long" } })}>// Lange Pause</button>
          <button onclick={() => act({ type: "addMark", mark: { type: "breath", block: hit.block, at: hit.offset } })}>✓ Atem</button>
        </div>
      {/if}
      {#if speech && speech.type === "speech"}
        <h4>Rede · {castName(speech.speaker)}</h4>
        <p class="muted small meta">{viaLabel(speech)}{speech.origin !== "user" ? ` · ${Math.round(speech.confidence * 100)} %` : ""}</p>
        <CastPicker {session} chapterId={chapter.id} current={speech.speaker} autofocus={!pop.alt}
          onPick={(id) => act({ type: "setSpeaker", ids: [speech.id], speaker: id })} />
        <div class="row">
          {#if speech.origin !== "user"}
            <button class="primary" onclick={() => act({ type: "confirmSpeech", ids: [speech.id] })}>Stimmt</button>
          {/if}
          <button onclick={() => splitHere(speech.id, hit.offset)} title="Die Rede an der geklickten Stelle teilen">Ab hier andere Figur</button>
          <button class="danger" onclick={() => act({ type: "removeAnnotation", id: speech.id })}>Keine Rede</button>
        </div>
      {/if}
      {#each anns.filter((a) => a.type !== "speech") as a (a.id)}
        <div class="mark">
          <strong>{MARK_LABEL[a.type]}</strong>
          {#if a.type === "note" || a.type === "retake"}
            <textarea rows="2" value={a.type === "note" ? a.text : (a.note ?? "")} placeholder="Notiz"
              onchange={(e) => session.apply({ type: "setNote", id: a.id, text: e.currentTarget.value })}></textarea>
          {/if}
          {#if a.type !== "quote"}
            <button class="danger ghost" onclick={() => act({ type: "removeAnnotation", id: a.id })}>Entfernen</button>
          {/if}
        </div>
      {/each}
    {/if}
  </Popover>
{:else if pop?.kind === "selection"}
  {@const sel = pop.sel}
  <Popover x={sel.x} y={sel.y} onClose={close} width={pop.step === "menu" ? 26 : 22}>
    {#if pop.step === "menu"}
      <div class="row">
        <button class="primary" onclick={() => pop?.kind === "selection" && (pop = { ...pop, step: "speaker" })}>Rede von …</button>
        <button onclick={() => act({ type: "addMark", mark: { type: "emphasis", block: sel.block, start: sel.start, end: sel.end } })}>Betonung</button>
        <button onclick={() => act({ type: "addMark", mark: { type: "retake", block: sel.block, start: sel.start, end: sel.end } })}>⟲ Retake</button>
        <button onclick={() => act({ type: "addMark", mark: { type: "bookmark", block: sel.block, start: sel.start, end: sel.end } })}>★</button>
        <button onclick={() => pop?.kind === "selection" && (pop = { ...pop, step: "note" })}>✎ Notiz</button>
      </div>
    {:else if pop.step === "speaker"}
      <h4>Wer spricht?</h4>
      <CastPicker {session} chapterId={chapter.id}
        onPick={(id) => { const [start, end] = speechRange(sel); act({ type: "addSpeech", block: sel.block, start, end, speaker: id }); }} />
    {:else}
      <h4>Notiz</h4>
      <form onsubmit={(e) => { e.preventDefault(); if (noteText.trim()) act({ type: "addMark", mark: { type: "note", block: sel.block, start: sel.start, end: sel.end, text: noteText.trim() } }); }}>
        <!-- svelte-ignore a11y_autofocus -->
        <textarea rows="3" bind:value={noteText} autofocus placeholder="z. B. flüsternd, Tempo raus"></textarea>
        <div class="row"><button class="primary" type="submit">Speichern</button></div>
      </form>
    {/if}
  </Popover>
{:else if pop?.kind === "point"}
  {@const point = session.book.annotations.find((a) => pop?.kind === "point" && a.id === pop.id)}
  <Popover x={pop.x} y={pop.y} onClose={close} width={14}>
    {#if point}
      <div class="mark">
        <strong>{point.type === "pause" && point.length === "long" ? "Lange Pause" : MARK_LABEL[point.type]}</strong>
        <button class="danger ghost" onclick={() => act({ type: "removeAnnotation", id: point.id })}>Entfernen</button>
      </div>
    {/if}
  </Popover>
{/if}

<style>
  .editor { display: grid; gap: 0.7rem; }
  .toolbar { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
  .legend { display: flex; gap: 0.35rem; flex-wrap: wrap; }
  .chip {
    display: inline-flex; align-items: center; gap: 0.35rem;
    border: 1px solid var(--line); border-radius: 99px; padding: 0.1rem 0.55rem 0.1rem 0.35rem;
    font-size: 0.82rem; background: var(--panel);
  }
  .hint { margin: 0; }
  .page { padding: 1.4rem 1.6rem 3rem; }
  h4 { margin: 0.2rem 0 0.35rem; font-size: 0.92rem; }
  .meta { margin: -0.2rem 0 0.5rem; }
  .row { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-top: 0.5rem; }
  .mark { display: grid; gap: 0.35rem; border-top: 1px solid var(--line); margin-top: 0.6rem; padding-top: 0.6rem; }
  .mark button { justify-self: start; }
  textarea { width: 100%; resize: vertical; }
</style>
