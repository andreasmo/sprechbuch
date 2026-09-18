<script lang="ts">
  import { endOf, startOf, type Annotation, type Ink } from "@sprechbuch/core";
  import { isTouch } from "../edition";
  import { emphasize, emphasizeStrike } from "../emphasis";
  import { MARK_LABEL, viaLabel } from "../labels";
  import { penName } from "../markers";
  import { snapSelection } from "../render";
  import type { BookSession } from "../store/session.svelte";
  import { settings } from "../store/settings.svelte";
  import CastPicker from "./CastPicker.svelte";
  import ChapterNav from "./ChapterNav.svelte";
  import InkSheet from "./InkSheet.svelte";
  import InkView from "./InkView.svelte";
  import Legend from "./Legend.svelte";
  import PenColors from "./PenColors.svelte";
  import PenPick from "./PenPick.svelte";
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
    // Ohne Alt-Taste (Finger): Pause, Atem und Satz teilen gibt es beim Antippen jeder Stelle
    const here = alt || isTouch();
    if (here || covering(hit).length) pop = { kind: "text", hit, alt: here };
    else pop = null;
  }
  const touch = isTouch();

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
    // Mit Offset der Satzgrenze – bleibt eindeutig, falls anderswo Sätze geteilt wurden (Zusammenführen)
    const at = session.lookup.blocks.get(block)?.block.sentences[sentence + 1]?.[0];
    session.apply({ type: "mergeSentences", block, index: sentence, ...(at !== undefined ? { at } : {}) });
  }

  function splitHere(id: string, at: number) {
    const created = session.apply({ type: "splitSpeech", id, at, speaker: null });
    if (created && pop?.kind === "text") pop = { ...pop, pickFor: created };
  }

  // ---- Handschrift ------------------------------------------------------------ //
  /** Schreibblatt: neue Notiz an einer Auswahl oder Handschrift einer vorhandenen Notiz */
  let sheet = $state<
    | { kind: "new"; block: string; start: number; end: number; text: string }
    | { kind: "edit"; id: string; ink: Ink | null; text: string }
    | null
  >(null);

  function openSheet(target: NonNullable<typeof sheet>) {
    close();
    sheet = target;
  }

  function saveSheet(res: { ink: Ink | null; text: string }) {
    const s = sheet;
    sheet = null;
    if (!s) return;
    if (s.kind === "new") {
      session.apply({ type: "addMark", mark: { type: "note", block: s.block, start: s.start, end: s.end, text: res.text, ...(res.ink ? { ink: res.ink } : {}) } });
      return;
    }
    if (JSON.stringify(res.ink) !== JSON.stringify(s.ink)) session.apply({ type: "setInk", id: s.id, ink: res.ink });
    if (res.text !== s.text) session.apply({ type: "setNote", id: s.id, text: res.text });
  }

  const castName = (id: string | null) => (id ? (session.lookup.cast.get(id)?.name ?? id) : "nicht zugeordnet");
</script>

<div class="editor">
  <div class="toolbar">
    <ChapterNav book={session.book} index={chapterIndex} onChange={(i) => { chapterIndex = i; close(); }} />
    <Legend {session} {chapter} limit={10} />
  </div>
  <PenColors {session} {chapter} />
  <p class="hint muted small">
    {#if touch}
      <strong>Stelle antippen</strong>: Sprecher ändern, Pause, Atem, Satz teilen · <strong>Lange drücken und markieren</strong>: Rede,
      Betonung, Notiz, Retake · <strong>|</strong> antippen: Sätze verbinden
    {:else}
      <strong>Rede anklicken</strong>: Sprecher ändern · <strong>Text markieren</strong>: Rede, Betonung, Notiz, Retake ·
      <kbd>Alt</kbd>+Klick: Satz teilen, Pause, Atem · <strong>|</strong> anklicken: Sätze verbinden
    {/if}
    {#if settings.penSeen}· <strong>Stift</strong>: durch oder unter Wörtern streichen = Betonung in der gewählten Farbe{/if}
  </p>

  <div class="page panel">
    <TextView {session} {chapter} mode="edit" {onText} onSelect={onSelect} {onPipe} onPoint={(id, x, y) => (pop = { kind: "point", id, x, y })}
      onStrike={(sel) => emphasizeStrike(session, sel)} />
  </div>
</div>

{#if sheet}
  <InkSheet ink={sheet.kind === "edit" ? sheet.ink : null} text={sheet.text} onSave={saveSheet} onClose={() => (sheet = null)} />
{/if}

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
        {#if speech.suggestion}
          {@const s = speech.suggestion}
          <p class="small alt">
            {s.source === "llm" ? "KI meint" : "Regeln meinten"}: <strong>{s.notSpeech ? "keine Rede" : castName(s.speaker)}</strong>
            <span class="muted">{Math.round(s.confidence * 100)} %{s.note ? ` · ${s.note}` : ""}</span>
            {#if s.notSpeech}
              <button class="small" onclick={() => act({ type: "removeAnnotation", id: speech.id })}>Übernehmen</button>
            {:else if s.speaker && session.lookup.cast.has(s.speaker)}
              <button class="small" onclick={() => act({ type: "setSpeaker", ids: [speech.id], speaker: s.speaker })}>Übernehmen</button>
            {/if}
          </p>
        {/if}
        <!-- Die Knöpfe vor der Figurenliste – so bleiben sie auch bei vielen Figuren ohne Scrollen erreichbar -->
        <div class="row actions">
          {#if speech.origin !== "user"}
            <button class="primary" onclick={() => act({ type: "confirmSpeech", ids: [speech.id] })}>Stimmt</button>
          {/if}
          <button onclick={() => splitHere(speech.id, hit.offset)} title="Die Rede an der geklickten Stelle teilen">Ab hier andere Figur</button>
          <button class="danger" onclick={() => act({ type: "removeAnnotation", id: speech.id })}>Keine Rede</button>
        </div>
        <CastPicker {session} chapterId={chapter.id} current={speech.speaker} autofocus={!pop.alt}
          onPick={(id) => act({ type: "setSpeaker", ids: [speech.id], speaker: id })} />
      {/if}
      {#each anns.filter((a) => a.type !== "speech") as a (a.id)}
        <div class="mark">
          <strong>{MARK_LABEL[a.type]}{#if a.type === "emphasis"} · {penName(a.color, session.book.emphasisLabels)}{/if}</strong>
          {#if a.type === "emphasis"}
            <PenPick value={a.color ?? null} labels={session.book.emphasisLabels}
              onPick={(c) => { settings.penColor = c; session.apply({ type: "setEmphasisColor", id: a.id, color: c }); }} />
          {/if}
          {#if a.type === "note" && a.ink}
            <button class="inkbox" onclick={() => openSheet({ kind: "edit", id: a.id, ink: a.ink ?? null, text: a.text })} title="Handschrift ändern">
              <InkView ink={a.ink} />
            </button>
          {/if}
          {#if a.type === "note" || a.type === "retake"}
            <textarea rows="2" value={a.type === "note" ? a.text : (a.note ?? "")} placeholder={a.type === "note" && a.ink ? "Getippt (optional)" : "Notiz"}
              onchange={(e) => session.apply({ type: "setNote", id: a.id, text: e.currentTarget.value })}></textarea>
          {/if}
          <div class="row tight">
            {#if a.type === "note"}
              <button onclick={() => openSheet({ kind: "edit", id: a.id, ink: a.ink ?? null, text: a.text })}>✍ {a.ink ? "Handschrift ändern" : "Mit Stift schreiben"}</button>
              {#if a.ink && a.text.trim()}
                <button class="ghost" onclick={() => act({ type: "setInk", id: a.id, ink: null })}>Handschrift entfernen</button>
              {/if}
            {/if}
            {#if a.type !== "quote"}
              <button class="danger ghost" onclick={() => act({ type: "removeAnnotation", id: a.id })}>Entfernen</button>
            {/if}
          </div>
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
        <button onclick={() => act({ type: "addMark", mark: { type: "retake", block: sel.block, start: sel.start, end: sel.end } })}>⟲ Retake</button>
        <button onclick={() => act({ type: "addMark", mark: { type: "bookmark", block: sel.block, start: sel.start, end: sel.end } })}>★</button>
        <button onclick={() => pop?.kind === "selection" && (pop = { ...pop, step: "note" })}>✎ Notiz</button>
      </div>
      <div class="emph-row">
        <span class="small muted">Betonung</span>
        <PenPick labels={session.book.emphasisLabels} onPick={(c) => { emphasize(session, sel.block, sel.start, sel.end, c); close(); }} />
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
        <div class="row">
          <button class="primary" type="submit">Speichern</button>
          <button type="button" onclick={() => openSheet({ kind: "new", block: sel.block, start: sel.start, end: sel.end, text: noteText.trim() })}
            title="Notiz von Hand schreiben – mit Stift oder Finger">✍ Mit Stift schreiben</button>
        </div>
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
  .hint { margin: 0; }
  .page { padding: 1.4rem 1.6rem 3rem; }
  h4 { margin: 0.2rem 0 0.35rem; font-size: 0.92rem; }
  .meta { margin: -0.2rem 0 0.5rem; }
  .alt { margin: -0.2rem 0 0.5rem; padding: 0.35rem 0.5rem; border-radius: 6px; background: color-mix(in srgb, var(--accent) 8%, transparent); }
  .alt button { padding: 0.1rem 0.45rem; margin-left: 0.3rem; }
  .row { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-top: 0.5rem; }
  .row.actions { margin: 0 0 0.6rem; }
  .mark { display: grid; gap: 0.35rem; border-top: 1px solid var(--line); margin-top: 0.6rem; padding-top: 0.6rem; }
  .mark button { justify-self: start; }
  .row.tight { margin-top: 0; }
  .emph-row { display: flex; align-items: center; flex-wrap: wrap; gap: 0.2rem 0.5rem; margin-top: 0.5rem; padding-top: 0.45rem; border-top: 1px solid var(--line); }
  .inkbox {
    justify-self: stretch !important; display: block; width: 100%; padding: 0.4rem 0.6rem; text-align: left; white-space: normal;
    border-left: 3px solid var(--warn); border-radius: 0 8px 8px 0; background: color-mix(in srgb, var(--warn) 12%, var(--panel));
  }
  textarea { width: 100%; resize: vertical; }
</style>
