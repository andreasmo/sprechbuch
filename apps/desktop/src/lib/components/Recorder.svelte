<script lang="ts">
  import type { Annotation } from "@sprechbuch/core";
  import { onDestroy, onMount, tick } from "svelte";
  import { fitMarginNotes } from "../dom";
  import { findSpeechSentence } from "../find";
  import { duration, fmt, isTyping } from "../labels";
  import { chapterCast, chapterSentences, type SentenceRef } from "../render";
  import type { BookSession } from "../store/session.svelte";
  import { nextTheme, settings } from "../store/settings.svelte";
  import { clock } from "../store/timer.svelte";
  import ChapterNav from "./ChapterNav.svelte";
  import Legend from "./Legend.svelte";
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

  // Wörter bis zum Kapitel / im Kapitel – für Fortschritt, Restzeit und Timer
  const chapterWords = $derived(sentences.reduce((n, s) => n + s.words, 0));
  const wordsBefore = $derived(sentences.slice(0, curIndex).reduce((n, s) => n + s.words, 0));
  const bookWordsBefore = $derived(
    session.book.chapters.slice(0, chapterIndex).reduce((n, c) => n + chapterSentences(c).reduce((m, s) => m + s.words, 0), 0),
  );
  const totalWords = $derived(session.stats.words);
  const globalWords = $derived(bookWordsBefore + wordsBefore);

  const timer = $derived(session.timer);
  $effect(() => timer.track(globalWords));

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

  // ---- Figur isolieren ----------------------------------------------------- //
  const castKeys = $derived(chapterCast(chapter, session.lookup.byBlock).filter((e) => e.id !== null));
  const isolated = $derived(session.isolate ? session.lookup.cast.get(session.isolate) : undefined);

  function jumpSpeech(dir: 1 | -1) {
    if (!session.isolate || !cur) return;
    const t = findSpeechSentence(session.book, session.lookup.byBlock, { chapterIndex, block: cur.block, sentence: cur.sentence }, dir, session.isolate);
    if (!t) {
      session.notify(`Keine ${dir === 1 ? "weitere" : "frühere"} Rede von ${isolated?.name ?? session.isolate}`);
      return;
    }
    if (t.chapterIndex !== chapterIndex) chapterIndex = t.chapterIndex;
    session.setPosition({ block: t.block, sentence: t.sentence });
  }

  // ---- Seitenmodus ----------------------------------------------------------- //
  const GAP = 48;
  let viewport = $state<HTMLElement>();
  let footer = $state<HTMLElement>();
  let layout = $state({ pageW: 600, cols: 1, height: 400, pages: 1 });
  let page = $state(0);

  const textEl = () => viewport?.querySelector<HTMLElement>(".textview") ?? null;

  function pageOf(el: Element): number {
    const tv = textEl();
    const first = el.getClientRects()[0];
    if (!tv || !first) return 0;
    const x = first.left - tv.getBoundingClientRect().left;
    return Math.floor(Math.floor((x + 2) / (layout.pageW + GAP)) / layout.cols);
  }

  async function measure() {
    if (!settings.paged || !viewport) return;
    const avail = viewport.parentElement?.clientWidth ?? window.innerWidth;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const pageW = Math.max(240, Math.min(avail, settings.columnWidth * rem));
    const cols = avail >= 2 * pageW + GAP ? 2 : 1;
    const height = Math.max(200, window.innerHeight - viewport.getBoundingClientRect().top - (footer?.offsetHeight ?? 0) - 14);
    layout = { ...layout, pageW, cols, height };
    await tick();
    const tv = textEl();
    if (!tv) return;
    fitMarginNotes(tv, settings.fontSize * settings.lineHeight);
    const last = tv.lastElementChild?.getClientRects();
    const right = last?.length ? last[last.length - 1]!.right - tv.getBoundingClientRect().left : 0;
    const extent = Math.max(tv.scrollWidth, right);
    layout = { ...layout, pages: Math.max(1, Math.ceil((extent + GAP) / (cols * (pageW + GAP)))) };
    showCurrentPage();
  }

  function showCurrentPage() {
    const el = viewport?.querySelector(".s.cur");
    page = Math.min(layout.pages - 1, el ? pageOf(el) : 0);
  }

  /** Blättern; die Leseposition folgt auf den ersten Satz der neuen Seite */
  function flip(d: number) {
    if (!settings.paged) return;
    const target = page + d;
    if (target < 0) {
      if (chapterIndex > 0) go(-1);
      return;
    }
    if (target >= layout.pages) {
      if (chapterIndex < session.book.chapters.length - 1) changeChapter(chapterIndex + 1);
      return;
    }
    page = target;
    const curEl = viewport?.querySelector(".s.cur");
    if (curEl && pageOf(curEl) === page) return;
    const first = [...(viewport?.querySelectorAll<HTMLElement>(".s") ?? [])].find((s) => pageOf(s) === page);
    const block = first?.closest<HTMLElement>("[data-block]")?.dataset.block;
    if (first && block) session.setPosition({ block, sentence: Number(first.dataset.s) });
  }

  // Layout neu berechnen, wenn sich Darstellung, Kapitel oder Text ändern
  $effect(() => {
    void [settings.paged, settings.fontSize, settings.lineHeight, settings.columnWidth, settings.font, settings.wordSpacing,
      settings.pipes, settings.badges, settings.breath, settings.numbers, settings.speech, settings.legend, settings.preview,
      chapter, session.book, session.isolate];
    if (!settings.paged) {
      // Anpassungen der Randnotizen aus dem Seitenmodus zurücknehmen
      void tick().then(() => { const tv = textEl(); if (tv) fitMarginNotes(tv, 0); });
      return;
    }
    stopAuto();
    window.scrollTo({ top: 0 });
    void tick().then(measure);
  });

  // Aktuellen Satz sichtbar halten: Seite wechseln bzw. auf etwa ein Drittel Blickhöhe scrollen
  $effect(() => {
    void curIndex;
    void chapterIndex;
    if (settings.paged) {
      void tick().then(showCurrentPage);
      return;
    }
    if (auto) return;
    void tick().then(() => {
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
  function stopAuto() {
    auto = false;
    cancelAnimationFrame(raf);
  }
  function toggleAuto() {
    if (auto) return stopAuto();
    if (settings.paged) {
      session.notify("Der Prompter läuft nur im Scrollmodus (Taste m)");
      return;
    }
    auto = true;
    const pxPerWord = (textEl()?.scrollHeight ?? 1000) / Math.max(1, chapterWords);
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

  function adoptTempo() {
    const w = timer.wpm;
    if (w === null) return;
    settings.wpm = Math.min(260, Math.max(80, Math.round(w / 5) * 5));
    session.notify(`Tempo auf ${settings.wpm} Wörter pro Minute gesetzt`);
  }

  // ---- Bildschirm anlassen ------------------------------------------------- //
  // Beim Einsprechen fasst niemand das Tablet an – ohne Sperre geht der Bildschirm nach einer Minute aus
  let wakeLock: WakeLockSentinel | null = null;
  async function keepAwake() {
    if (document.visibilityState !== "visible" || !("wakeLock" in navigator) || (wakeLock && !wakeLock.released)) return;
    try {
      wakeLock = await navigator.wakeLock.request("screen");
    } catch {
      // z. B. Energiesparmodus – dann eben nicht
    }
  }
  // Die Sperre endet, sobald die Seite verdeckt ist; beim Zurückkehren neu anfordern
  const onVisibility = () => void keepAwake();
  onMount(() => {
    void keepAwake();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      void wakeLock?.release().catch(() => {});
      wakeLock = null;
    };
  });

  // ---- Wischen ------------------------------------------------------------- //
  // Seitenmodus: nach links wischen blättert vor; Scrollmodus: nächster/voriger Satz
  let swipe: { x: number; y: number; id: number } | null = null;
  function onPointerDown(ev: PointerEvent) {
    if (ev.pointerType === "mouse") return;
    swipe = { x: ev.clientX, y: ev.clientY, id: ev.pointerId };
  }
  function onPointerUp(ev: PointerEvent) {
    const s = swipe;
    swipe = null;
    if (!s || s.id !== ev.pointerId) return;
    const dx = ev.clientX - s.x;
    const dy = ev.clientY - s.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < 1.5 * Math.abs(dy)) return;
    if (settings.paged) flip(dx < 0 ? 1 : -1);
    else go(curIndex + (dx < 0 ? 1 : -1));
  }

  function onKey(ev: KeyboardEvent) {
    if (noteOpen || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (isTyping(ev)) return;
    const k = ev.key;
    if (k === " " || k === "ArrowRight" || k === "j") go(curIndex + (ev.shiftKey && k === " " ? -1 : 1));
    else if (k === "ArrowLeft" || k === "k") go(curIndex - 1);
    else if (k === "PageDown" && settings.paged) flip(1);
    else if (k === "PageUp" && settings.paged) flip(-1);
    else if (k === "]") chapterIndex < session.book.chapters.length - 1 && changeChapter(chapterIndex + 1);
    else if (k === "[") chapterIndex > 0 && changeChapter(chapterIndex - 1);
    else if (k === "a") toggleAuto();
    else if (k === "m") settings.paged = !settings.paged;
    else if (k === "r") toggle("retake");
    else if (k === "b") toggle("bookmark");
    else if (k === "n") noteOpen = true;
    else if (k === "f") settings.focus = !settings.focus;
    else if (k === "l") settings.legend = !settings.legend;
    else if (k === "z") timer.toggle(globalWords);
    else if (k === "+" || k === "=") settings.fontSize = Math.min(44, settings.fontSize + 1);
    else if (k === "-") settings.fontSize = Math.max(14, settings.fontSize - 1);
    else if (k === "t") nextTheme();
    else if (/^[1-9]$/.test(k)) {
      const e = castKeys[Number(k) - 1];
      if (!e?.id) return;
      session.toggleIsolate(e.id);
    } else if (k === "0") session.clearIsolation();
    else if ((k === "." || k === ",") && session.isolate) jumpSpeech(k === "." ? 1 : -1);
    else return;
    ev.preventDefault();
  }
</script>

<svelte:window onkeydown={onKey} onresize={() => settings.paged && void measure()} />

<div class="recorder" class:paged={settings.paged}>
  <div class="bar panel">
    <ChapterNav book={session.book} index={chapterIndex} onChange={changeChapter} />
    <button class:primary={auto} onclick={toggleAuto} disabled={settings.paged} title={settings.paged ? "Nur im Scrollmodus" : "Prompter (a)"}>{auto ? "⏸ Prompter" : "▶ Prompter"}</button>
    <label class="wpm small">Tempo <input type="range" min="80" max="260" step="5" bind:value={settings.wpm} /> <span class="tabular">{settings.wpm}</span></label>
    <button class="ghost" class:on={settings.paged} aria-pressed={settings.paged} onclick={() => (settings.paged = !settings.paged)} title="Seitenmodus: blättern statt scrollen (m)">Seiten</button>
    <button class="ghost" class:on={settings.focus} aria-pressed={settings.focus} onclick={() => (settings.focus = !settings.focus)} title="Fokus auf den aktuellen Satz (f)">Fokus</button>
    <span class="grow"></span>
    <div class="timer" class:running={timer.running}>
      <button class="ghost" onclick={() => timer.toggle(globalWords)} title={timer.running ? "Timer anhalten (z)" : "Aufnahme-Timer starten (z)"}>
        {timer.running ? "⏸" : "⏱"} <span class="tabular">{clock(timer.elapsed)}</span>
      </button>
      {#if timer.started}
        <span class="small muted tabular" title="Gemessenes Sprechtempo seit Start">{timer.wpm ?? "–"} WpM</span>
        {#if timer.wpm !== null}<button class="ghost small" onclick={adoptTempo} title="Gemessenes Tempo für Restzeit und Prompter übernehmen">übernehmen</button>{/if}
        {#if !timer.running}<button class="ghost small" onclick={() => timer.reset()} title="Timer zurücksetzen" aria-label="Timer zurücksetzen">✕</button>{/if}
      {/if}
    </div>
    <button class="ghost" class:on={settings.legend} aria-pressed={settings.legend} onclick={() => (settings.legend = !settings.legend)} title="Legende (l)">Legende</button>
  </div>

  {#if settings.legend}
    <div class="legend-row">
      <Legend {session} {chapter} keys />
      {#if isolated}
        <p class="iso small">
          <strong>{isolated.name}</strong>{isolated.voiceNote ? ` – ${isolated.voiceNote}` : ""}
          <button class="ghost small" onclick={() => jumpSpeech(-1)} title="Vorige Rede ( , )">‹ vorige Rede</button>
          <button class="ghost small" onclick={() => jumpSpeech(1)} title="Nächste Rede ( . )">nächste Rede ›</button>
        </p>
      {/if}
    </div>
  {/if}

  <div class="progress" aria-hidden="true">
    <span class="book" style="width: {(100 * globalWords) / Math.max(1, totalWords)}%"></span>
    <span class="chapter" style="width: {(100 * wordsBefore) / Math.max(1, chapterWords)}%"></span>
  </div>
  <p class="stats small muted tabular">
    Satz <strong>{fmt(curIndex + 1)}</strong> / {fmt(sentences.length)} ·
    Kapitel {chapterIndex + 1} / {session.book.chapters.length} ·
    {#if settings.paged}Seite <strong>{page + 1}</strong> / {layout.pages} ·{/if}
    Rest ≈ <strong>{duration((totalWords - globalWords) / settings.wpm)}</strong> ·
    Buch {((100 * globalWords) / Math.max(1, totalWords)).toFixed(1)} %
  </p>

  <div class="page">
    <div
      class="viewport"
      bind:this={viewport}
      onpointerdown={onPointerDown}
      onpointerup={onPointerUp}
      onpointercancel={() => (swipe = null)}
      role="presentation"
      style={settings.paged
        ? `--pw: ${layout.pageW}px; --cols: ${layout.cols}; --gap: ${GAP}px; --px: ${-page * layout.cols * (layout.pageW + GAP)}px; height: ${layout.height}px; width: ${layout.cols * layout.pageW + (layout.cols - 1) * GAP}px`
        : undefined}
    >
      <TextView
        {session}
        {chapter}
        mode="record"
        current={cur ? { block: cur.block, sentence: cur.sentence } : null}
        isRead={(b, s) => (indexOf.get(key(b, s)) ?? Infinity) < curIndex}
        onSentence={(p) => session.setPosition(p)}
      />
    </div>
  </div>

  <footer class="panel" bind:this={footer}>
    {#if settings.preview}
      <p class="next"><span class="label">Als Nächstes</span><span class="text">{nextText}</span></p>
    {/if}
    <div class="transport">
      <button onclick={() => go(curIndex - 1)} title="Satz zurück (←)">◀ Satz</button>
      <button class="primary" onclick={() => go(curIndex + 1)} title="Nächster Satz (Leertaste)">Satz ▶</button>
      {#if settings.paged}
        <button onclick={() => flip(-1)} title="Seite zurück (Bild ↑)">‹ Seite</button>
        <button onclick={() => flip(1)} title="Seite vor (Bild ↓)">Seite ›</button>
      {/if}
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
      <span class="keys muted small"><kbd>Leer</kbd> weiter · <kbd>1</kbd>–<kbd>9</kbd> Figur · <kbd>m</kbd> Seiten · <kbd>?</kbd> alle Tasten</span>
    </div>
  </footer>
</div>

<style>
  .recorder { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.5rem; padding-bottom: 9rem; }
  .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; padding: 0.45rem 0.6rem; position: sticky; top: 3.6rem; z-index: 5; }
  .paged { padding-bottom: 0; }
  /* Im Seitenmodus passt alles ins Fenster – nichts soll mitscrollen */
  :global(body:has(.recorder.paged)) { overflow: hidden; }
  .wpm { display: inline-flex; align-items: center; gap: 0.4rem; }
  .wpm input { width: 6.5rem; }
  .grow { flex: 1; }
  button.on { border-color: var(--accent); color: var(--accent); }
  button.ghost.on { background: color-mix(in srgb, var(--accent) 12%, transparent); }
  .timer { display: inline-flex; align-items: center; gap: 0.2rem; }
  .timer.running > button:first-child { color: var(--danger); font-weight: 600; }
  .legend-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem 1rem; }
  .iso { margin: 0; display: inline-flex; align-items: center; gap: 0.3rem; flex-wrap: wrap; }
  .iso button { padding: 0.15rem 0.45rem; color: var(--accent); }
  .progress { position: relative; height: 4px; background: var(--line); border-radius: 99px; overflow: hidden; }
  .progress span { position: absolute; inset: 0 auto 0 0; }
  .progress .book { background: var(--muted); opacity: 0.45; }
  .progress .chapter { background: var(--accent); }
  .stats { margin: 0; }
  .page { padding: 1rem 0 0; }
  .paged .page { padding-top: 0.4rem; }

  .viewport { margin: 0 auto; }
  .paged .viewport { overflow: hidden; }
  .paged .viewport :global(.textview) {
    max-width: none;
    width: 100%;
    height: 100%;
    column-count: var(--cols);
    column-gap: var(--gap);
    column-fill: auto;
    transform: translateX(var(--px));
    transition: transform 0.18s ease;
  }
  .paged .viewport :global(.textview > :first-child) { margin-top: 0; }
  .paged .viewport :global(.textview h2), .paged .viewport :global(.textview h3) { break-after: avoid; }

  footer {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 20;
    border-radius: 0; border-width: 1px 0 0;
    padding: 0.5rem max(1rem, env(safe-area-inset-right)) calc(0.6rem + env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left));
  }
  /* Senkrecht scrollen bleibt dem Browser, waagerechtes Wischen gehört dem Blättern */
  .viewport { touch-action: pan-y pinch-zoom; }
  .paged .viewport { touch-action: none; }
  .next { max-width: 52rem; margin: 0 auto 0.4rem; display: flex; gap: 0.7rem; align-items: baseline; }
  .next .label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); flex: none; }
  .next .text {
    font-family: var(--read); font-size: 1.05rem; line-height: 1.4;
    display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .transport { max-width: 52rem; margin: 0 auto; display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; }
  .note { display: flex; gap: 0.3rem; }
  .note input { width: 16rem; }
  @media (max-width: 900px), (hover: none) and (pointer: coarse) { .keys { display: none; } }
  /* Finger: Transportknöpfe groß und über die Breite verteilt */
  @media (pointer: coarse) {
    .transport button { min-height: 3.2rem; padding: 0.4rem 1rem; font-size: 1rem; }
    .transport button.primary { flex: 1 1 8rem; }
    .recorder { padding-bottom: 11rem; }
  }
</style>
