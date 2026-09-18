<script lang="ts">
  import { fmt } from "../labels";
  import { penStyle } from "../markers";
  import { listMarks, MARK_KINDS, marksToCsv, marksToText, type MarkKind, type MarkRow } from "../marks";
  import type { BookSession } from "../store/session.svelte";
  import InkView from "./InkView.svelte";

  let { session, onRecordAt, onShowInText }: {
    session: BookSession;
    onRecordAt: (row: MarkRow) => void;
    onShowInText: (row: MarkRow) => void;
  } = $props();

  const rows = $derived(listMarks(session.book, session.lookup));
  let filter = $state<MarkKind | "all">("all");
  let showAll = $state(false);
  const filtered = $derived(filter === "all" ? rows : rows.filter((r) => r.type === filter));
  const shown = $derived(showAll ? filtered : filtered.slice(0, 25));
  const count = (k: MarkKind) => rows.filter((r) => r.type === k).length;

  const ICON: Record<MarkKind, string> = { retake: "⟲", bookmark: "★", note: "✎", emphasis: "A" };
  const LABEL: Record<MarkKind, string> = { retake: "Retakes", bookmark: "Lesezeichen", note: "Notizen", emphasis: "Betonungen" };

  async function copy() {
    try {
      await navigator.clipboard.writeText(marksToText(filtered));
      session.notify(`${fmt(filtered.length)} Markierungen kopiert`);
    } catch {
      session.notify("Kopieren nicht möglich – bitte als CSV exportieren", "error");
    }
  }
</script>

<section class="panel card">
  <div class="card-head">
    <h2>Markierungen <span class="muted count">{fmt(rows.length)}</span></h2>
    {#if rows.length}
      <div class="actions">
        <button class="ghost" onclick={copy}>Kopieren</button>
        <button onclick={() => session.exportText(marksToCsv(filtered), `${session.fileName} – Markierungen.csv`, "csv")}>Als CSV exportieren</button>
      </div>
    {/if}
  </div>

  {#if !rows.length}
    <p class="muted small empty">
      Noch nichts markiert. Beim Aufnehmen setzt <kbd>r</kbd> einen Retake, <kbd>b</kbd> ein Lesezeichen und <kbd>n</kbd> eine Notiz
      am aktuellen Satz – hier sammelt sich dann die Liste für die Nachbearbeitung, zusammen mit Betonungen und ihren Farben.
    </p>
  {:else}
    <div class="filters" role="group" aria-label="Filter">
      <button class="ghost" class:active={filter === "all"} onclick={() => (filter = "all")}>Alle</button>
      {#each MARK_KINDS as k (k)}
        {#if count(k)}<button class="ghost" class:active={filter === k} onclick={() => (filter = k)}>{ICON[k]} {LABEL[k]} <span class="muted tabular">{count(k)}</span></button>{/if}
      {/each}
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th></th><th>Stelle</th><th>Text</th><th>Notiz / Farbe</th><th></th></tr></thead>
        <tbody>
          {#each shown as r (r.id)}
            <tr>
              <td class="icon {r.type}" title={LABEL[r.type]}>{#if r.type === "emphasis"}<span class="emph" style={penStyle(r.color)}>A</span>{:else}{ICON[r.type]}{/if}</td>
              <td class="where tabular"><span title={r.chapterTitle}>Kap. {r.chapterIndex + 1}</span><br /><span class="muted small">Satz {fmt(r.number)}</span></td>
              <td class="text">{r.text}</td>
              <td class="note">
                {#if r.type === "bookmark"}
                  <span class="muted">–</span>
                {:else if r.type === "emphasis"}
                  <span class="pen" class:muted={r.color === null}>{r.pen}</span>
                {:else}
                  {#if r.ink}<span class="ink"><InkView ink={r.ink} /></span>{/if}
                  <input value={r.note} placeholder={r.type === "retake" ? "Grund, z. B. versprochen" : r.ink ? "getippt, optional" : ""} aria-label="Notiz"
                    onchange={(e) => session.apply({ type: "setNote", id: r.id, text: e.currentTarget.value })} />
                {/if}
              </td>
              <td class="row-actions">
                <button class="ghost small" onclick={() => onRecordAt(r)} title="Im Aufnahmemodus an diesen Satz springen">Aufnehmen</button>
                <button class="ghost small" onclick={() => onShowInText(r)}>Im Text</button>
                <button class="ghost small danger" onclick={() => session.apply({ type: "removeAnnotation", id: r.id })} title="Markierung entfernen" aria-label="Entfernen">✕</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if filtered.length > 25}
      <button class="ghost more" onclick={() => (showAll = !showAll)}>{showAll ? "Weniger anzeigen" : `Alle ${fmt(filtered.length)} anzeigen`}</button>
    {/if}
  {/if}
</section>

<style>
  .card { padding: 1rem 1.2rem; display: grid; gap: 0.7rem; }
  .card-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
  h2 { font-size: 1rem; }
  .count { font-weight: 400; }
  .actions { display: flex; gap: 0.4rem; }
  .empty { margin: 0; }
  .filters { display: flex; gap: 0.2rem; flex-wrap: wrap; }
  .filters button { padding: 0.2rem 0.6rem; border-radius: 99px; font-size: 0.85rem; }
  .filters button.active { background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  th { text-align: left; font-weight: 600; color: var(--muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; padding: 0 0.4rem 0.4rem; }
  td { padding: 0.35rem 0.4rem; border-top: 1px solid var(--line); vertical-align: top; }
  .icon { font-weight: 700; width: 1.5rem; }
  .icon.retake { color: var(--danger); }
  .icon.bookmark { color: var(--warn); }
  .icon.note { color: var(--accent); }
  .emph {
    font-family: var(--read);
    text-decoration-line: underline;
    text-decoration-style: var(--pen-line, solid);
    text-decoration-color: var(--pen, currentColor);
    text-decoration-thickness: var(--pen-thick, 0.12em);
    text-underline-offset: 0.18em;
  }
  .ink { display: block; width: 7.5rem; margin-bottom: 0.25rem; padding: 0.2rem 0.35rem; border-left: 3px solid var(--warn); border-radius: 0 6px 6px 0;
    background: color-mix(in srgb, var(--warn) 12%, var(--panel)); max-height: 5rem; overflow: hidden; }
  .pen { font-size: 0.85rem; }
  .where { white-space: nowrap; }
  .text { font-family: var(--read); min-width: 16rem; }
  .note input { width: 100%; min-width: 9rem; }
  .row-actions { white-space: nowrap; text-align: right; }
  .row-actions button { padding: 0.2rem 0.45rem; }
  .more { justify-self: start; color: var(--accent); }
</style>
