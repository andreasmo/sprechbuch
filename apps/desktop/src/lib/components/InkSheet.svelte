<script lang="ts">
  import type { Ink } from "@sprechbuch/core";
  import { fromInk, INK_LINE, INK_STROKE, INK_WIDTH, toInk, touchedStrokes, type Pt } from "../ink";
  import { settings } from "../store/settings.svelte";
  import InkView from "./InkView.svelte";

  /**
   * Schreibblatt für handschriftliche Notizen: groß schreiben, im Rand verkleinert zeigen.
   * Die Striche stehen in normierten Einheiten (Breite 1000) – so bleibt alles an seinem Platz,
   * auch wenn sich das Blatt beim Drehen des Tablets verbreitert.
   */
  let { ink = null, text = "", onSave, onClose }: {
    ink?: Ink | null;
    text?: string;
    onSave: (result: { ink: Ink | null; text: string }) => void;
    onClose: () => void;
  } = $props();

  const MIN_LINES = 3;
  // svelte-ignore state_referenced_locally
  let strokes = $state.raw<Pt[][]>(ink ? fromInk(ink) : []);
  // svelte-ignore state_referenced_locally
  let typed = $state(text);
  // svelte-ignore state_referenced_locally
  let lines = $state(Math.max(MIN_LINES, Math.ceil(((ink?.h ?? 0) + INK_LINE * 0.4) / INK_LINE)));
  let history = $state.raw<Pt[][][]>([]);
  let eraser = $state(false);
  let width = $state(0);
  let innerHeight = $state(800);
  let canvas: HTMLCanvasElement;

  const scale = $derived(width / INK_WIDTH);
  const heightUnits = $derived(lines * INK_LINE + INK_LINE * 0.3);
  const maxLines = $derived(Math.max(MIN_LINES, Math.floor((innerHeight * 0.5) / Math.max(1, INK_LINE * scale))));
  const result = $derived(toInk(strokes));

  /** Breite der Randnotiz beim Lesen (ohne Innenabstand) – für die Vorschau in echter Größe */
  const noteWidth = $derived.by(() => {
    const fs = settings.fontSize;
    const narrow = typeof window !== "undefined" && window.innerWidth <= 600;
    const noteFont = Math.max(12, fs * 0.64);
    return (narrow ? 4.5 : 6.6) * fs - 1.05 * noteFont - 3;
  });

  // ---- Zeichnen -------------------------------------------------------------- //
  let active: { id: number; pts: Pt[]; erase: boolean } | null = null;
  /** Schreibt jemand mit dem Stift, zählen Finger auf dem Blatt nicht (Handballen) */
  let penUsed = false;

  function colors() {
    const cs = getComputedStyle(canvas);
    return { ink: cs.getPropertyValue("--fg").trim() || "#000", line: cs.getPropertyValue("--line").trim() || "#ccc" };
  }

  function strokePath(ctx: CanvasRenderingContext2D, pts: readonly Pt[]) {
    const k = scale;
    ctx.beginPath();
    ctx.moveTo(pts[0]!.x * k, pts[0]!.y * k);
    if (pts.length === 1) ctx.lineTo(pts[0]!.x * k, pts[0]!.y * k);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i]!.x + pts[i + 1]!.x) / 2;
      const my = (pts[i]!.y + pts[i + 1]!.y) / 2;
      ctx.quadraticCurveTo(pts[i]!.x * k, pts[i]!.y * k, mx * k, my * k);
    }
    if (pts.length > 1) ctx.lineTo(pts.at(-1)!.x * k, pts.at(-1)!.y * k);
    ctx.stroke();
  }

  function redraw() {
    if (!canvas || !width) return;
    const dpr = window.devicePixelRatio || 1;
    const h = heightUnits * scale;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const c = colors();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, h);
    // Linien wie im Schreibheft – ihr Abstand ergibt im Rand die Größe getippter Notizen
    ctx.strokeStyle = c.line;
    ctx.lineWidth = 1;
    for (let i = 1; i <= lines; i++) {
      const y = Math.round((i * INK_LINE - INK_LINE * 0.22) * scale) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    Object.assign(ctx, { strokeStyle: c.ink, lineWidth: INK_STROKE * scale, lineCap: "round", lineJoin: "round" });
    for (const s of strokes) strokePath(ctx, s);
    if (active && !active.erase) strokePath(ctx, active.pts);
  }

  $effect(() => {
    void [strokes, width, lines, settings.theme];
    redraw();
  });

  function toUnits(ev: { clientX: number; clientY: number }): Pt {
    const r = canvas.getBoundingClientRect();
    return { x: (ev.clientX - r.left) / scale, y: (ev.clientY - r.top) / scale };
  }

  function commit(next: Pt[][]) {
    history = [...history.slice(-49), strokes];
    strokes = next;
  }

  function eraseAlong(path: readonly Pt[]) {
    const hit = touchedStrokes(strokes, path, 10 / Math.max(scale, 0.01));
    if (hit.size) commit(strokes.filter((_, i) => !hit.has(i)));
  }

  function onDown(ev: PointerEvent) {
    if (ev.pointerType === "pen") penUsed = true;
    else if (ev.pointerType === "touch" && penUsed) return;
    // 5 = Radiererende des Stifts
    if (ev.button !== 0 && ev.button !== 5) return;
    ev.preventDefault();
    canvas.setPointerCapture?.(ev.pointerId);
    const erase = eraser || ev.button === 5 || (ev.buttons & 32) !== 0;
    active = { id: ev.pointerId, pts: [toUnits(ev)], erase };
    if (erase) eraseAlong(active.pts);
    else redraw();
  }

  function onMove(ev: PointerEvent) {
    if (!active || ev.pointerId !== active.id) return;
    const coalesced = ev.getCoalescedEvents?.() ?? [];
    const fresh = (coalesced.length ? coalesced : [ev]).map(toUnits);
    active.pts.push(...fresh);
    if (active.erase) {
      eraseAlong(fresh);
      return;
    }
    // Unten angekommen: eine Zeile dazu, solange das Blatt ins Fenster passt
    if (Math.max(...fresh.map((p) => p.y)) > (lines - 0.5) * INK_LINE && lines < maxLines) lines++;
    else redraw();
  }

  function onUp(ev: PointerEvent) {
    if (!active || ev.pointerId !== active.id) return;
    const done = active;
    active = null;
    if (!done.erase) commit([...strokes, done.pts]);
  }

  function undo() {
    const prev = history.at(-1);
    if (!prev) return;
    history = history.slice(0, -1);
    strokes = prev;
  }

  function save() {
    onSave({ ink: result, text: typed.trim() });
  }

  function onKey(ev: KeyboardEvent) {
    // Solange das Blatt offen ist, gelten Tasten nur hier (Strg+Z nimmt den letzten Strich zurück, nicht die letzte Buchänderung)
    ev.stopPropagation();
    if (ev.key === "Escape") {
      ev.preventDefault();
      onClose();
    } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z" && !(ev.target instanceof HTMLInputElement)) {
      ev.preventDefault();
      undo();
    }
  }
</script>

<svelte:window onkeydowncapture={onKey} bind:innerHeight />

<!-- Daneben tippen schließt nur, solange noch nichts geschrieben ist – sonst ginge die Handschrift verloren -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="backdrop" onclick={() => !history.length && onClose()}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="sheet panel" role="dialog" aria-modal="true" aria-labelledby="ink-title" tabindex="-1" onclick={(e) => e.stopPropagation()}>
    <header>
      <h2 id="ink-title">Handschriftliche Notiz</h2>
      <button class="ghost" onclick={onClose} aria-label="Schließen">✕</button>
    </header>
    <p class="muted small hint">Groß schreiben, ruhig über mehrere Zeilen – im Rand erscheint die Notiz verkleinert.</p>

    <div class="paper" bind:clientWidth={width}>
      <canvas
        bind:this={canvas}
        class:erasing={eraser}
        onpointerdown={onDown}
        onpointermove={onMove}
        onpointerup={onUp}
        onpointercancel={onUp}
        aria-label="Schreibfläche"
      ></canvas>
    </div>

    <div class="tools">
      <button onclick={undo} disabled={!history.length} title="Letzten Strich zurücknehmen (Strg+Z)">↶ Strich</button>
      <button class:on={eraser} aria-pressed={eraser} onclick={() => (eraser = !eraser)} title="Radierer: überstrichene Striche entfernen">⌫ Radierer</button>
      <button class="ghost" onclick={() => commit([])} disabled={!strokes.length}>Leeren</button>
      <span class="grow"></span>
      {#if result}
        <span class="preview-label muted small">So im Rand:</span>
        <span class="preview" style="width: {noteWidth}px"><InkView ink={result} /></span>
      {/if}
    </div>

    <label class="typed">
      <span class="small muted">Getippt (optional – für Suche, Liste und Export)</span>
      <input bind:value={typed} placeholder="z. B. leiser werden" />
    </label>

    <div class="actions">
      <button class="ghost" onclick={onClose}>Abbrechen</button>
      <button class="primary" onclick={save} disabled={!result && !typed.trim()}>Speichern</button>
    </div>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 70; background: rgb(0 0 0 / 0.4); display: grid; place-items: center; padding: 1rem; }
  .sheet { width: min(32rem, 100%); max-height: 94vh; overflow: auto; padding: 0.9rem 1.1rem 1.1rem; display: grid; gap: 0.6rem; }
  header { display: flex; justify-content: space-between; align-items: center; }
  h2 { font-size: 1.05rem; }
  .hint { margin: -0.3rem 0 0; }
  .paper { border: 1px solid var(--line); border-radius: 8px; background: var(--bg); overflow: hidden; }
  canvas { display: block; width: 100%; touch-action: none; cursor: crosshair; }
  canvas.erasing { cursor: cell; }
  .tools { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; }
  .tools button.on { border-color: var(--accent); color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); }
  .grow { flex: 1; }
  .preview {
    display: block; padding: 0.2rem 0.3rem; border-left: 3px solid var(--warn); border-radius: 0 6px 6px 0;
    background: color-mix(in srgb, var(--warn) 15%, var(--panel)); max-height: 6rem; overflow: hidden;
  }
  .typed { display: grid; gap: 0.2rem; }
  .typed input { width: 100%; }
  .actions { display: flex; justify-content: flex-end; gap: 0.4rem; }
</style>
