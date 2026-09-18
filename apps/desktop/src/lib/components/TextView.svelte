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
  import { penSlot, type BookChapter } from "@sprechbuch/core";
  import { rangeFor, setHighlight, strokeOverlay } from "../dom";
  import { isTouch } from "../edition";
  import { classifyStrike, type Pt, type Strike } from "../ink";
  import { markVar, penStyle, strongVar } from "../markers";
  import { breathChunks, LONG_SENTENCE, renderBlock, sentenceNumbers, type Piece, type SpeechInfo, type TextPiece } from "../render";
  import { FONT_STACK, settings } from "../store/settings.svelte";
  import type { BookSession, Position } from "../store/session.svelte";
  import InkView from "./InkView.svelte";

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
    onStrike,
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
    /** Stift: waagerecht durch Wörter gestrichen (Bereich roh, noch nicht auf Wörter erweitert); null = nicht erkannt */
    onStrike?: (sel: TextSelection | null) => void;
  } = $props();

  let root: HTMLElement;

  const blocks = $derived(blockIds ? chapter.blocks.filter((b) => blockIds.includes(b.id)) : chapter.blocks);
  const cast = $derived(session.lookup.cast);
  const numbers = $derived(sentenceNumbers(chapter));

  /** Abblenden: Prüf-Fokus auf eine Rede, sonst isolierte bzw. stumm geschaltete Figuren */
  function dimmed(sp: SpeechInfo): boolean {
    if (focusSpeech !== undefined) return focusSpeech !== sp.id;
    if (mode === "review") return false;
    if (session.isolate !== null) return sp.speaker !== session.isolate;
    return sp.speaker !== null && session.muted.includes(sp.speaker);
  }

  // Suchtreffer dieses Kapitels hervorheben (CSS Custom Highlights, ohne neu zu rendern)
  $effect(() => {
    if (mode === "review") return;
    const search = session.search;
    const current = search.current;
    // Abhängigkeiten, die das DOM verändern
    void [session.book, settings.breath, settings.badges, settings.speech, chapter];
    const inChapter = search.open ? search.result.hits.filter((h) => session.lookup.blocks.get(h.block)?.chapter.id === chapter.id) : [];
    const ranges = (list: typeof inChapter) => list.map((h) => rangeFor(root, h.block, h.start, h.end)).filter((r) => r !== null);
    setHighlight("sb-search", ranges(inChapter.filter((h) => h !== current)));
    setHighlight("sb-search-current", current && inChapter.includes(current) ? ranges([current]) : []);
    return () => {
      setHighlight("sb-search", []);
      setHighlight("sb-search-current", []);
    };
  });

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
    // Nach einem Stiftstrich meldet der Browser noch einen Klick – der ist keiner.
    // Den selbst ausgelösten Klick eines Stift-Tippers (isTrusted: false) lassen wir durch.
    if (ev.isTrusted && performance.now() < swallowClickUntil) return;
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

  /** Aktuelle Textauswahl melden. `below`: Menü unter der Auswahl – darüber zeigt iOS sein eigenes Menü */
  function reportSelection(below: boolean) {
    if (!onSelect) return;
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
    onSelect({
      block: a.block, start: Math.min(a.offset, b.offset), end: Math.max(a.offset, b.offset),
      x: rect.left + rect.width / 2, y: below ? rect.bottom + 12 : rect.top,
    });
  }

  function onMouseUp() {
    if (mode !== "edit" || !onSelect) return;
    // Auswahl erst nach dem Browser-Update auswerten
    setTimeout(() => reportSelection(false), 0);
  }

  // Finger: Markieren geht per langem Druck und Ziehen der Griffe – ohne mouseup. Erst melden, wenn die Auswahl ruht.
  $effect(() => {
    if (mode !== "edit" || !onSelect || !isTouch()) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onChange = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed && root.contains(sel.anchorNode)) reportSelection(true);
      }, 650);
    };
    document.addEventListener("selectionchange", onChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", onChange);
    };
  });

  // ---- Stift ---------------------------------------------------------------- //
  // Waagerecht durch oder unter Wörtern streichen setzt eine Betonung; Antippen wirkt wie mit dem Finger.
  const PEN_TAP_TARGETS = ".mnote, .icon, [data-point], button";
  let pen: { id: number; points: Pt[]; overlay: ReturnType<typeof strokeOverlay> | null } | null = null;
  let swallowClickUntil = 0;

  function penColor(): string {
    const i = penSlot(settings.penColor);
    return getComputedStyle(root).getPropertyValue(i === null ? "--fg" : `--pen${i}`).trim() || "currentColor";
  }

  /**
   * Gehört der Strich zum Text? Ein Unterstrich fängt gern knapp neben der Spalte an, deshalb ein
   * Rand von zwei Zeilen um die Textansicht. Knöpfe, Menüs und Randnotizen bleiben zum Antippen.
   */
  function nearText(ev: PointerEvent | TouchEvent, x: number, y: number): boolean {
    const el = ev.target as Element | null;
    if (el?.closest?.(`${PEN_TAP_TARGETS}, .popover, .sheet, input, textarea, select, a`)) return false;
    const r = root.getBoundingClientRect();
    const pad = settings.fontSize * 2;
    return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
  }

  function onPenDown(ev: PointerEvent) {
    if (ev.pointerType !== "pen") return;
    if (!settings.penSeen) settings.penSeen = true;
    if (ev.button !== 0 || !nearText(ev, ev.clientX, ev.clientY)) return;
    ev.preventDefault(); // Chromium behandelt den Stift sonst wie eine Maus und markiert Text
    root.setPointerCapture?.(ev.pointerId);
    pen = { id: ev.pointerId, points: [{ x: ev.clientX, y: ev.clientY }], overlay: null };
  }

  function onPenMove(ev: PointerEvent) {
    if (!pen || ev.pointerId !== pen.id) return;
    const coalesced = ev.getCoalescedEvents?.() ?? [];
    const fresh = (coalesced.length ? coalesced : [ev]).map((e) => ({ x: e.clientX, y: e.clientY }));
    pen.points.push(...fresh);
    if (pen.overlay) {
      for (const p of fresh) pen.overlay.add(p.x, p.y);
      return;
    }
    const first = pen.points[0]!;
    if (Math.hypot(ev.clientX - first.x, ev.clientY - first.y) < 6) return;
    pen.overlay = strokeOverlay(penColor(), Math.max(2, settings.fontSize * 0.12));
    for (const p of pen.points) pen.overlay.add(p.x, p.y);
  }

  function onPenUp(ev: PointerEvent) {
    if (!pen || ev.pointerId !== pen.id) return;
    const { points, overlay } = pen;
    pen = null;
    if (!overlay) {
      // Antippen: Weil die Berührung abgefangen wurde, meldet der Browser keinen Klick – also selbst einen auslösen
      swallowClickUntil = performance.now() + 500;
      document.elementFromPoint(ev.clientX, ev.clientY)?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, clientX: ev.clientX, clientY: ev.clientY, view: window }));
      return;
    }
    overlay.done();
    swallowClickUntil = performance.now() + 500;
    const strike = classifyStrike(points, settings.fontSize, settings.fontSize * settings.lineHeight);
    onStrike?.(strike ? strikeRange(strike) : null);
  }

  function onPenCancel(ev: PointerEvent) {
    if (pen?.id !== ev.pointerId) return;
    pen.overlay?.done();
    pen = null;
  }

  /** Strich → Textbereich. Der Strich muss an einer Textzeile liegen; unterstrichen zählt wie durchgestrichen. */
  function strikeRange(s: Strike): TextSelection | null {
    const lh = settings.fontSize * settings.lineHeight;
    // Unterstreichungen liegen unter der Grundlinie – etwas höher tasten, damit die eigene Zeile gefunden wird
    const y = s.y - 0.2 * lh;
    const inset = Math.min(settings.fontSize * 0.3, (s.x2 - s.x1) / 4);
    const a = caretAt(s.x1 + inset, y);
    const b = caretAt(s.x2 - inset, y);
    const ha = a && root.contains(a.node) ? hitFromNode(a.node, a.offset) : null;
    const hb = b && root.contains(b.node) ? hitFromNode(b.node, b.offset) : null;
    if (!ha || !hb || ha.block !== hb.block || ha.offset === hb.offset) return null;
    const start = Math.min(ha.offset, hb.offset);
    const end = Math.max(ha.offset, hb.offset);
    // caretAt findet auch weit weg vom Text die nächste Stelle – der Strich muss wirklich an der Zeile liegen
    const rects = [...(rangeFor(root, ha.block, start, end)?.getClientRects() ?? [])];
    if (!rects.some((r) => r.right > s.x1 && r.left < s.x2 && s.y > r.top - 0.4 * lh && s.y < r.bottom + 0.5 * lh)) return null;
    return { block: ha.block, start, end, x: (s.x1 + s.x2) / 2, y: s.y + 0.5 * lh };
  }

  // Am Fenster lauschen, nicht am Text: Ein Strich beginnt oft neben der Spalte, und beim Ziehen
  // kann der Zeiger überall landen. Safari bekommt zusätzlich die Berührung abgefangen, sonst
  // scrollt oder markiert der Stift, statt zu zeichnen.
  $effect(() => {
    if (!onStrike) return;
    const onTouch = (e: TouchEvent) => {
      const stylus = [...e.changedTouches].find((t) => (t as Touch & { touchType?: string }).touchType === "stylus");
      if (!stylus || !nearText(e, stylus.clientX, stylus.clientY)) return;
      e.preventDefault();
    };
    window.addEventListener("pointerdown", onPenDown, true);
    window.addEventListener("pointermove", onPenMove, true);
    window.addEventListener("pointerup", onPenUp, true);
    window.addEventListener("pointercancel", onPenCancel, true);
    window.addEventListener("touchstart", onTouch, { passive: false, capture: true });
    return () => {
      window.removeEventListener("pointerdown", onPenDown, true);
      window.removeEventListener("pointermove", onPenMove, true);
      window.removeEventListener("pointerup", onPenUp, true);
      window.removeEventListener("pointercancel", onPenCancel, true);
      window.removeEventListener("touchstart", onTouch, true);
    };
  });

  /** Notizen stehen links neben dem Text – beim Lesen aus dem Augenwinkel sichtbar. Platz dafür nur, wenn es welche gibt. */
  const marginNotes = $derived(
    mode !== "review" && blocks.some((b) => (session.lookup.byBlock.get(b.id) ?? []).some((a) => a.type === "note")),
  );

  const isCur = (block: string, s: number | null) => s !== null && current?.block === block && current.sentence === s;
  const icon = (t: "retake" | "note" | "bookmark") => (t === "retake" ? "⟲" : t === "note" ? "✎" : "★");
</script>

{#snippet txt(p: TextPiece)}{@const chunks = settings.breath ? breathChunks(p.text, p.start) : null}{#if chunks}{#each chunks as c, ci (ci)}<span
        data-start={c.start}
        data-end={c.end}
        class:brk={c.breath}>{c.text}</span
      >{/each}{:else}{p.text}{/if}{/snippet}

{#snippet pieces(list: Piece[])}
  {#each list as p, i (i)}
    {#if p.kind === "point"}
      <span class="pt" class:long={p.long} data-point={p.id} title={p.mark === "breath" ? "Atemzeichen" : p.long ? "lange Pause" : "Pause"}
        >{p.mark === "breath" ? "✓" : p.long ? "//" : "/"}</span
      >
    {:else}
      {#if marginNotes}{#each p.starts ?? [] as s (s.id)}{#if s.type === "note"}<span class="mnote" class:hand={!!s.ink} data-icon-at={p.start} title={s.text || "Handschriftliche Notiz"}
            >{#if s.ink}<InkView ink={s.ink} />{#if s.text}<span class="typed">{s.text}</span>{/if}{:else}{s.text}{/if}</span
          >{/if}{/each}{/if}{#each p.starts ?? [] as s (s.id)}<span class="icon {s.type}" data-icon-at={p.start} title={s.text || (s.ink ? "Handschriftliche Notiz" : "")}>{icon(s.type)}</span>{/each}<span
        data-start={p.start}
        data-end={p.end}
        class="t"
        style={p.emphasis ? penStyle(p.pen) || undefined : undefined}
        class:it={p.italic}
        class:bd={p.bold}
        class:emph={p.emphasis}
        class:retake={p.retake}
        class:note={p.note}
        class:q2={p.quote}
      >{#if p.speech}<mark
            class="sp"
            class:weak={p.speech.weak}
            class:dim={dimmed(p.speech)}
            class:focus={focusSpeech === p.speech.id}
            style="--mark: {markVar(p.speech.slot)}; --strong: {strongVar(p.speech.slot)}"
            title={p.speech.speaker ? (cast.get(p.speech.speaker)?.name ?? p.speech.speaker) : "nicht zugeordnet"}
            >{#if p.speech.badge}<span class="badge">{p.speech.badge}</span>{/if}{@render txt(p)}</mark
          >{:else}{@render txt(p)}{/if}</span
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
  class:numbers={settings.numbers && mode !== "review"}
  class:warn-long={settings.warnLong}
  class:margin-notes={marginNotes}
  class:pen-strike={!!onStrike}
  style="--fs: {settings.fontSize}px; --lh: {settings.lineHeight}; --colw: {settings.columnWidth}rem; --ws: {settings.wordSpacing}em; --read-font: {FONT_STACK[settings.font]}"
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
              class:long={seg.words > LONG_SENTENCE}
              data-s={seg.sentence}
              data-n={(numbers.get(block.id) ?? 1) + seg.sentence}>{@render pieces(seg.pieces)}</span
            >{#if settings.pipes && seg.sentence < block.sentences.length - 1}{#if mode === "edit"}<button
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
    font-family: var(--read-font, var(--read));
    font-size: var(--fs);
    line-height: var(--lh);
    word-spacing: var(--ws, 0);
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
  /* Fokus dimmt nur den Text – Notizen zu kommenden Sätzen sollen weiter warnen */
  .focus-mode .s:not(.cur) { opacity: 1; }
  .focus-mode .s:not(.cur) > :not(.mnote), .focus-mode .s:not(.cur)::before { opacity: 0.3; }
  .focus-mode .s.read > .mnote { opacity: 0.5; }
  .numbers .s::before {
    content: attr(data-n);
    font: 600 0.52em/1 var(--ui);
    font-variant-numeric: tabular-nums;
    color: var(--muted);
    vertical-align: 0.9em;
    margin-right: 0.22em;
    user-select: none;
  }
  .warn-long .s.long { text-decoration: underline dotted color-mix(in srgb, var(--warn) 70%, transparent); text-decoration-thickness: 0.09em; text-underline-offset: 0.34em; }
  .brk { box-shadow: inset 0 -0.22em 0 color-mix(in srgb, var(--accent) 60%, transparent); padding: 0 0.14em 0 0.06em; border-radius: 0.1em; }

  .it { font-style: italic; }
  .bd { font-weight: 700; }
  /* Betonung: schlicht in Textfarbe, mit Stiftfarbe in deren Farbe und Linienart (--pen… aus penStyle) */
  .emph {
    text-decoration-line: underline;
    text-decoration-style: var(--pen-line, solid);
    text-decoration-color: var(--pen, currentColor);
    text-decoration-thickness: var(--pen-thick, 0.12em);
    text-underline-offset: 0.18em;
    font-weight: 600;
  }
  /* Rede als Unterstrich: die Betonung darunter, damit sich beide Linien nicht decken */
  [data-speech="underline"] .emph { text-underline-offset: 0.44em; }
  /* Waagerechtes Streichen mit dem Stift gehört der Geste, senkrecht scrollt weiter */
  .pen-strike { touch-action: pan-y pinch-zoom; }
  .retake { text-decoration: underline wavy var(--danger); text-decoration-thickness: 1px; text-underline-offset: 0.3em; }
  .note { border-bottom: 1px dotted var(--note); }
  .icon { font: 700 0.62em/1 var(--ui); vertical-align: 0.5em; margin: 0 0.15em; cursor: pointer; user-select: none; }
  .icon.retake { color: var(--danger); text-decoration: none; }
  .icon.note { color: var(--note); }

  /* Randnotizen (wie Marginalien): schwebend links neben der Zeile, in der die Notiz beginnt.
     clear stapelt dicht aufeinanderfolgende Notizen untereinander; die Blöcke rücken dafür nach rechts. */
  .textview { --note: var(--warn); --note-w: calc(var(--fs) * 7.4); --note-gap: calc(var(--fs) * 0.8); }
  .margin-notes { max-width: calc(var(--colw) + var(--note-w)); }
  .margin-notes > * { margin-left: var(--note-w); }
  .margin-notes > p.quote { margin-left: calc(var(--note-w) + 1.4em); }
  .mnote {
    float: left;
    clear: left;
    width: calc(var(--note-w) - var(--note-gap));
    margin: calc(var(--fs) * 0.3) var(--note-gap) calc(var(--fs) * 0.35) calc(-1 * var(--note-w));
    padding: 0.28em 0.5em 0.32em 0.55em;
    font: 600 max(12px, calc(var(--fs) * 0.64)) / 1.32 var(--ui);
    font-style: normal;
    letter-spacing: normal;
    word-spacing: normal;
    white-space: normal;
    text-align: left;
    overflow-wrap: anywhere;
    hyphens: auto;
    -webkit-hyphens: auto;
    color: var(--fg);
    background: color-mix(in srgb, var(--note) 15%, var(--panel));
    border-left: 3px solid var(--note);
    border-radius: 0 6px 6px 0;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 6;
    line-clamp: 6;
    overflow: hidden;
  }
  /* Handschrift: skaliert mit der Randbreite; statt Zeilen zu kürzen höchstens gut sieben Zeilen hoch */
  .mnote.hand { display: block; max-height: 10.2em; }
  .mnote .typed { display: block; margin-top: 0.25em; }
  .quote .mnote { margin-left: calc(-1 * (var(--note-w) + var(--fs) * 2.2) - 2px); }
  [data-mode="edit"] .mnote:hover { background: color-mix(in srgb, var(--note) 26%, var(--panel)); }
  @media (max-width: 600px) {
    .textview { --note-w: calc(var(--fs) * 5); --note-gap: calc(var(--fs) * 0.5); }
  }
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
  :global(mark.sp.dim) { opacity: 0.35; }
  :global(mark.sp.focus) { box-shadow: 0 0 0 2px var(--accent); }
</style>
