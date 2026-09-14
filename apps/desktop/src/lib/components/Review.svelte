<script lang="ts">
  import { slotOf } from "@sprechbuch/core";
  import { fmt, isTyping, viaLabel } from "../labels";
  import { markVar, strongVar } from "../markers";
  import { chapterCast } from "../render";
  import type { BookSession } from "../store/session.svelte";
  import CastPicker from "./CastPicker.svelte";
  import Popover from "./Popover.svelte";
  import TextView from "./TextView.svelte";

  let { session, onShowInText }: { session: BookSession; onShowInText: (block: string) => void } = $props();

  let index = $state(0);
  let decided = $state(0);
  let picker = $state<{ x: number; y: number } | null>(null);

  const queue = $derived(session.queue);
  const pos = $derived(Math.min(index, Math.max(0, queue.length - 1)));
  const item = $derived(queue[pos]);
  const ref = $derived(item ? session.lookup.blocks.get(item.block) : undefined);

  /** Kontext: bis zu zwei Absätze davor, einer danach */
  const contextIds = $derived.by(() => {
    if (!ref) return [];
    const blocks = ref.chapter.blocks;
    const i = ref.blockIndex;
    return blocks.slice(Math.max(0, i - 2), i + 2).filter((b) => b.type !== "h1" && b.type !== "h2" || b.id === item?.block).map((b) => b.id);
  });

  /** Die Figuren dieses Kapitels, häufigste zuerst – die ersten neun per Zifferntaste */
  const choices = $derived.by(() => {
    if (!ref) return [];
    return chapterCast(ref.chapter, session.lookup.byBlock).filter((e) => e.id !== null).slice(0, 9)
      .map((e) => session.lookup.cast.get(e.id!)).filter((c) => !!c);
  });

  function decide(edit: Parameters<BookSession["apply"]>[0]) {
    if (!item) return;
    const before = queue.length;
    session.apply(edit);
    if (session.queue.length < before) decided++;
    picker = null;
  }

  const confirm = () => item && decide({ type: "confirmSpeech", ids: [item.id] });
  /** Vorschlag übernehmen: andere Figur oder „keine Rede“ */
  const takeSuggestion = () => {
    const s = item?.suggestion;
    if (!item || !s) return;
    if (s.notSpeech) noSpeech();
    else if (s.speaker && session.lookup.cast.has(s.speaker)) assign(s.speaker);
  };
  const assign = (speaker: string) => item && decide({ type: "setSpeaker", ids: [item.id], speaker });
  const noSpeech = () => item && decide({ type: "removeAnnotation", id: item.id });
  const skip = (d: number) => (index = Math.min(Math.max(0, pos + d), Math.max(0, queue.length - 1)));

  function onKey(ev: KeyboardEvent) {
    if (picker || !item || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (isTyping(ev)) return;
    const k = ev.key;
    if (k === "Enter") confirm();
    else if (/^[1-9]$/.test(k)) {
      const c = choices[Number(k) - 1];
      if (c) assign(c.id);
    } else if (k === "Delete" || k === "n" || k === "N") noSpeech();
    else if ((k === "v" || k === "V") && item.suggestion) takeSuggestion();
    else if (k === "ArrowRight" || k === "s" || k === "S") skip(1);
    else if (k === "ArrowLeft") skip(-1);
    else return;
    ev.preventDefault();
  }

  const castName = (id: string | null) => (id ? (session.lookup.cast.get(id)?.name ?? id) : "nicht zugeordnet");
</script>

<svelte:window onkeydown={onKey} />

<section class="review">
  {#if !item}
    <div class="done panel">
      <div class="big" aria-hidden="true">✓</div>
      <h2>Alles geprüft</h2>
      <p class="muted">
        Es gibt keine unsicheren Zuordnungen mehr{decided ? ` – ${fmt(decided)} in dieser Sitzung entschieden` : ""}.
      </p>
    </div>
  {:else if ref}
    <header>
      <div>
        <h2>Zuordnung prüfen</h2>
        <p class="muted small">
          {fmt(pos + 1)} von {fmt(queue.length)} offen{decided ? ` · ${fmt(decided)} entschieden` : ""} · {ref.chapter.title}
        </p>
      </div>
      <div class="progress" aria-hidden="true">
        <span style="width: {(100 * decided) / Math.max(1, decided + queue.length)}%"></span>
      </div>
    </header>

    <div class="context panel">
      <TextView {session} chapter={ref.chapter} mode="review" blockIds={contextIds} focusSpeech={item.id} />
    </div>

    <div class="guess panel">
      <p>
        Vorschlag:
        {#if item.speaker}
          {@const slot = slotOf(session.book, ref.chapter.id, item.speaker, session.lookup.cast)}
          <mark class="sp" style="--mark: {markVar(slot)}; --strong: {strongVar(slot)}">{castName(item.speaker)}</mark>
        {:else}<strong>keine Figur</strong>{/if}
        <span class="muted">· {viaLabel(item)} · {Math.round(item.confidence * 100)} %</span>
      </p>
      {#if item.suggestion}
        {@const s = item.suggestion}
        <p class="alt">
          <span class="alt-label">{s.source === "llm" ? "KI meint" : "Regeln meinten"}:</span>
          {#if s.notSpeech}<strong>keine direkte Rede</strong>
          {:else if s.speaker}
            {@const slot = slotOf(session.book, ref.chapter.id, s.speaker, session.lookup.cast)}
            <mark class="sp" style="--mark: {markVar(slot)}; --strong: {strongVar(slot)}">{castName(s.speaker)}</mark>
          {/if}
          <span class="muted">· {Math.round(s.confidence * 100)} %{s.note ? ` · ${s.note}` : ""}</span>
          {#if s.notSpeech || (s.speaker && session.lookup.cast.has(s.speaker))}
            <button class="small" onclick={takeSuggestion}>Übernehmen <kbd>V</kbd></button>
          {/if}
        </p>
      {/if}

      <div class="actions">
        {#if item.speaker}
          <button class="primary" onclick={confirm}>Stimmt <kbd>Enter</kbd></button>
        {/if}
        {#each choices as c, i (c.id)}
          {@const slot = slotOf(session.book, ref.chapter.id, c.id, session.lookup.cast)}
          <button onclick={() => assign(c.id)} class:current={c.id === item.speaker}>
            <kbd>{i + 1}</kbd>
            <span class="swatch" style="--mark: {markVar(slot)}; --strong: {strongVar(slot)}"></span>
            {c.name}
          </button>
        {/each}
        <button onclick={(e) => (picker = { x: e.clientX, y: e.clientY })}>Andere Figur …</button>
      </div>
      <div class="actions secondary">
        <button class="danger" onclick={noSpeech}>Keine Rede <kbd>N</kbd></button>
        <button onclick={() => skip(-1)} disabled={pos === 0}>‹ Zurück</button>
        <button onclick={() => skip(1)} disabled={pos >= queue.length - 1}>Überspringen <kbd>→</kbd></button>
        <span class="grow"></span>
        <button class="ghost" onclick={() => onShowInText(item.block)}>Im Text zeigen</button>
      </div>
    </div>
  {/if}
</section>

{#if picker && item && ref}
  <Popover x={picker.x} y={picker.y} onClose={() => (picker = null)} width={22}>
    <CastPicker {session} chapterId={ref.chapter.id} current={item.speaker} onPick={assign} />
  </Popover>
{/if}

<style>
  .review { display: grid; gap: 1rem; max-width: 52rem; margin: 0 auto; }
  header { display: grid; gap: 0.6rem; }
  h2 { font-size: 1.2rem; }
  header p { margin: 0.25rem 0 0; }
  .progress { height: 0.35rem; background: var(--line); border-radius: 99px; overflow: hidden; }
  .progress span { display: block; height: 100%; background: var(--ok); transition: width 0.2s; }
  .context { padding: 1.2rem 1.4rem; }
  .guess { padding: 1rem 1.2rem; display: grid; gap: 0.7rem; }
  .guess p { margin: 0; }
  .alt { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: baseline; padding: 0.45rem 0.6rem; border-radius: 8px; background: color-mix(in srgb, var(--accent) 7%, transparent); }
  .alt-label { font-weight: 600; }
  .alt button { padding: 0.15rem 0.55rem; }
  .actions { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; }
  .actions button { display: inline-flex; align-items: center; gap: 0.4rem; }
  .actions button.current { border-color: var(--accent); }
  .secondary { border-top: 1px solid var(--line); padding-top: 0.7rem; }
  .grow { flex: 1; }
  .done { text-align: center; padding: 3rem 1.5rem; }
  .big { font-size: 2.6rem; color: var(--ok); }
</style>
