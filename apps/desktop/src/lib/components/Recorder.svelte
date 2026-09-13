<script lang="ts">
  import type { Annotation } from "@sprechbuch/core";
  import { onDestroy, tick } from "svelte";
  import { duration, fmt, isTyping } from "../labels";
  import { chapterSentences, type SentenceRef } from "../render";
  import type { BookSession } from "../store/session.svelte";
  import { settings, type Theme } from "../store/settings.svelte";
  import ChapterNav from "./ChapterNav.svelte";
  import TextView from "./TextView.svelte";

  let { session, chapterIndex = $bindable(0) }: { session: BookSession; chapterIndex: number } = $props();

  const chapter = $derived(session.book.chapters[Math.min(chapterIndex, session.book.chapters.length - 1)]!);
  const sentences = $derived(chapterSentences(chapter));
  const indexOf = $derived(new Map(sentences.map((s, i) => [`${s.block}:${s.sentence}`, i])));
  const key = (block: string, s: number) => `${block}:${s}`;

  /** Aktuelle Position – gehört sie nicht zu diesem Kapitel, gilt der erste Satz */
  const curIndex = $derived.by(() => {
    const p = session.position;
    const i = p ? indexOf.get(key(p.block, p.sentence)) : undefined;
    return i ?? 0;
  });
  const cur = $derived<SentenceRef | undefined>(sentences[curIndex]);
  const next = $derived<SentenceRef | undefined>(sentences[curIndex + 1]);

  // Wörter bis zum Kapitel / im Kapitel – für Fortschritt und Restzeit
  const chapterWords = $derived(sentences.reduce((n, s) => n + s.words, 0));
  const wordsBefore = $derived(sentences.slice(0, curIndex).reduce((n, s) => n + s.words, 0));
  const bookWordsBefore = $derived(
    session.book.chapters.slice(0, chapterIndex).reduce((n, c) => n + chapterSentences(c).reduce((m, s) => m + s.words, 0), 0),
  );
  const totalWords = $derived(session.stats.words);

  const nextText = $derived.by(() => {
    if (!next) return "— Kapitelende —";
    const b = session.lookup.blocks.get(next.block)?.block;
    return b ? b.text.slice(next.start, next.end) : "";
  });

  function go(i: number) {
    if (i < 0) {
      if (chapterIndex > 0) {
        chapterIndex--;
        const prev = chapterSentences(session.book.chapters[chapterIndex]!);
        const last = prev.at(-1);
        if (last) session.setPosition({ block: last.block, sentence: last.sentence });
      }
      return;
    }
    if (i >= sentences.length) {
      if (chapterIndex < session.book.chapters.length - 1) changeChapter(chapterIndex + 1);
      return;
    }
    const s = sentences[i]!;
    session.setPosition({ block: s.block, sentence: s.sentence });
  }

  function changeChapter(i: number) {
    chapterIndex = i;
    const first = chapterSentences(session.book.chapters[i]!)[0];
    if (first) session.setPosition({ block: first.block, sentence: first.sentence });
    window.scrollTo({ top: 0 });
  }

  // Aktuellen Satz sichtbar halten (Blickhöhe etwa ein Drittel)
  $effect(() => {
    void curIndex;
    void chapterIndex;
    if (auto) return;
    tick().then(() => {
      const el = document.querySelector<HTMLElement>(".recorder .s.cur");
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight * 0.2 || r.bottom > window.innerHeight * 0.68) {
        window.scrollBy({ top: r.top - window.innerHeight * 0.34, behavior: "smooth" });
      }
    });
  });

  // ---- Markierungen am aktuellen Satz ------------------------------------ //
  const sentenceMark = (type: "retake" | "bookmark"): Annotation | undefined =>
    cur ? (session.lookup.byBlock.get(cur.block) ?? []).find((a) => a.type === type && a.start === cur.start && a.end === cur.end) : undefined;
  const hasRetake = $derived(!!cur && !!sentenceMark("retake"));
  const hasBookmark = $derived(!!cur && !!sentenceMark("bookmark"));

  function toggle(type: "retake" | "bookmark") {
    if (!cur) return;
    const existing = sentenceMark(type);
    if (existing) session.apply({ type: "removeAnnotation", id: existing.id });
    else session.apply({ type: "addMark", mark: { type, block: cur.block, start: cur.start, end: cur.end } });
  }

  let noteOpen = $state(false);
  let noteText = $state("");
  function saveNote() {
    if (cur && noteText.trim()) {
      session.apply({ type: "addMark", mark: { type: "note", block: cur.block, start: cur.start, end: cur.end, text: noteText.trim() } });
    }
    noteOpen = false;
    noteText = "";
  }

  // ---- Prompter ------------------------------------------------------------ //
  let auto = $state(false);
  let raf = 0;
  function toggleAuto() {
    auto = !auto;
    cancelAnimationFrame(raf);
    if (!auto) return;
    const textEl = document.querySelector<HTMLElement>(".recorder .textview");
    const pxPerWord = (textEl?.scrollHeight ?? 1000) / Math.max(1, chapterWords);
    let last = performance.now();
    let acc = 0;
    const step = (t: number) => {
      acc += ((settings.wpm / 60) * pxPerWord * (t - last)) / 1000;
      last = t;
      if (acc >= 1) {
        window.scrollBy(0, Math.floor(acc));
        acc -= Math.floor(acc);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }
  onDestroy(() => cancelAnimationFrame(raf));

  const THEMES: [Theme, string][] = [["auto", "Automatisch"], ["light", "Hell"], ["sepia", "Sepia"], ["dark", "Dunkel"], ["studio", "Studio"]];

  function onKey(ev: KeyboardEvent) {
    if (noteOpen || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (isTyping(ev)) return;
    const k = ev.key;
    if (k === " " || k === "ArrowRight" || k === "j") go(curIndex + (ev.shiftKey && k === " " ? -1 : 1));
    else if (k === "ArrowLeft" || k === "k") go(curIndex - 1);
    else if (k === "]") chapterIndex < session.book.chapters.length - 1 && changeChapter(chapterIndex + 1);
    else if (k === "[") chapterIndex > 0 && changeChapter(chapterIndex - 1);
    else if (k === "a") toggleAuto();
    else if (k === "r") toggle("retake");
    else if (k === "b") toggle("bookmark");
    else if (k === "n") noteOpen = true;
    else if (k === "f") settings.focus = !settings.focus;
    else if (k === "+" || k === "=") settings.fontSize = Math.min(44, settings.fontSize + 1);
    else if (k === "-") settings.fontSize = Math.max(14, settings.fontSize - 1);
    else if (k === "t") settings.theme = THEMES[(THEMES.findIndex(([t]) => t === settings.theme) + 1) % THEMES.length]![0];
    else return;
    ev.preventDefault();
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="recorder">
  <div class="bar panel">
    <ChapterNav book={session.book} index={chapterIndex} onChange={changeChapter} />
    <button class:primary={auto} onclick={toggleAuto} title="Prompter (a)">{auto ? "⏸ Prompter" : "▶ Prompter"}</button>
    <label class="wpm small">Tempo <input type="range" min="80" max="260" step="5" bind:value={settings.wpm} /> <span class="tabular">{settings.wpm}</span> WpM</label>
    <span class="grow"></span>
    <button class="ghost" onclick={() => (settings.fontSize = Math.max(14, settings.fontSize - 1))} title="Kleiner (-)">A−</button>
    <button class="ghost" onclick={() => (settings.fontSize = Math.min(44, settings.fontSize + 1))} title="Größer (+)">A+</button>
    <select bind:value={settings.theme} aria-label="Thema">
      {#each THEMES as [t, label] (t)}<option value={t}>{label}</option>{/each}
    </select>
    <select bind:value={settings.speech} aria-label="Rede-Darstellung">
      <option value="marker">Textmarker</option>
      <option value="underline">Unterstrichen</option>
      <option value="off">ohne Farbe</option>
    </select>
    <button class="ghost" class:on={settings.focus} onclick={() => (settings.focus = !settings.focus)} title="Fokus (f)">Fokus</button>
    <button class="ghost" class:on={settings.pipes} onclick={() => (settings.pipes = !settings.pipes)} title="Pipes ein/aus">|</button>
  </div>

  <div class="progress" aria-hidden="true">
    <span class="book" style="width: {(100 * (bookWordsBefore + wordsBefore)) / Math.max(1, totalWords)}%"></span>
    <span class="chapter" style="width: {(100 * wordsBefore) / Math.max(1, chapterWords)}%"></span>
  </div>
  <p class="stats small muted tabular">
    Satz <strong>{fmt(curIndex + 1)}</strong> / {fmt(sentences.length)} ·
    Kapitel {chapterIndex + 1} / {session.book.chapters.length} ·
    Rest ≈ <strong>{duration((totalWords - bookWordsBefore - wordsBefore) / settings.wpm)}</strong> ·
    Buch {((100 * (bookWordsBefore + wordsBefore)) / Math.max(1, totalWords)).toFixed(1)} %
  </p>

  <div class="page">
    <TextView
      {session}
      {chapter}
      mode="record"
      current={cur ? { block: cur.block, sentence: cur.sentence } : null}
      isRead={(b, s) => (indexOf.get(key(b, s)) ?? Infinity) < curIndex}
      onSentence={(p) => session.setPosition(p)}
    />
  </div>

  <footer class="panel">
    {#if settings.preview}
      <p class="next"><span class="label">Als Nächstes</span><span class="text">{nextText}</span></p>
    {/if}
    <div class="transport">
      <button onclick={() => go(curIndex - 1)} title="Satz zurück (←)">◀ Satz</button>
      <button class="primary" onclick={() => go(curIndex + 1)} title="Nächster Satz (Leertaste)">Satz ▶</button>
      <button class:on={hasRetake} onclick={() => toggle("retake")} title="Retake (r)">⟲ Retake</button>
      <button class:on={hasBookmark} onclick={() => toggle("bookmark")} title="Lesezeichen (b)">★ Marker</button>
      {#if noteOpen}
        <form class="note" onsubmit={(e) => { e.preventDefault(); saveNote(); }}>
          <!-- svelte-ignore a11y_autofocus -->
          <input bind:value={noteText} autofocus placeholder="Notiz zum Satz" onkeydown={(e) => e.key === "Escape" && (noteOpen = false)} />
          <button type="submit">OK</button>
        </form>
      {:else}
        <button onclick={() => (noteOpen = true)} title="Notiz (n)">✎ Notiz</button>
      {/if}
      <span class="grow"></span>
      <span class="keys muted small"><kbd>Leer</kbd> weiter · <kbd>←</kbd> zurück · <kbd>a</kbd> Prompter · <kbd>f</kbd> Fokus · <kbd>t</kbd> Thema</span>
    </div>
  </footer>
</div>

<style>
  .recorder { display: grid; gap: 0.5rem; padding-bottom: 9rem; }
  .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; padding: 0.45rem 0.6rem; position: sticky; top: 3.6rem; z-index: 5; }
  .wpm { display: inline-flex; align-items: center; gap: 0.4rem; }
  .wpm input { width: 7rem; }
  .grow { flex: 1; }
  button.on { border-color: var(--accent); color: var(--accent); }
  .progress { position: relative; height: 4px; background: var(--line); border-radius: 99px; overflow: hidden; }
  .progress span { position: absolute; inset: 0 auto 0 0; }
  .progress .book { background: var(--muted); opacity: 0.45; }
  .progress .chapter { background: var(--accent); }
  .stats { margin: 0; }
  .page { padding: 1rem 0 0; }
  footer {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 20;
    border-radius: 0; border-width: 1px 0 0; padding: 0.5rem 1rem 0.6rem;
  }
  .next { max-width: 52rem; margin: 0 auto 0.4rem; display: flex; gap: 0.7rem; align-items: baseline; }
  .next .label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); flex: none; }
  .next .text {
    font-family: var(--read); font-size: 1.05rem; line-height: 1.4;
    display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .transport { max-width: 52rem; margin: 0 auto; display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; }
  .note { display: flex; gap: 0.3rem; }
  .note input { width: 16rem; }
</style>
