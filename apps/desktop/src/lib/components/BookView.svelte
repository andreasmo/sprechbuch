<script lang="ts">
  import { MARKER_SLOTS } from "@sprechbuch/core";
  import { markVar, strongVar } from "../markers";
  import type { LoadedBook } from "../worker/protocol";
  import ChapterPreview from "./ChapterPreview.svelte";

  let { loaded }: { loaded: LoadedBook } = $props();

  const book = $derived(loaded.book);
  const stats = $derived(loaded.stats);
  const fmt = (n: number) => n.toLocaleString("de-DE");

  /** Verfahren nach Verlässlichkeit gruppiert. */
  const GROUPS = [
    { key: "sure", label: "sicher", hint: "Inquit direkt an der Rede", vias: ["inquit_after", "inquit_before", "user"], color: "var(--ok)" },
    { key: "derived", label: "abgeleitet", hint: "gleicher Absatz, Pronomen, Fortsetzung", vias: ["same_paragraph", "continuation", "pronoun", "inquit_paragraph"], color: "var(--accent)" },
    { key: "guessed", label: "geraten", hint: "Nähe, Wechselrede – bitte prüfen", vias: ["proximity", "alternation"], color: "var(--warn)" },
    { key: "open", label: "offen", hint: "keine Zuordnung", vias: ["unknown"], color: "var(--danger)" },
  ];
  const groups = $derived(GROUPS.map((g) => ({ ...g, n: g.vias.reduce((s, v) => s + (stats.byVia[v] ?? 0), 0) })));
  const castEntries = $derived(new Map(book.cast.map((c) => [c.id, c])));
  let showAll = $state(false);
  const castRows = $derived(showAll ? stats.cast : stats.cast.slice(0, 12));
</script>

<article class="book">
  <header class="head">
    <div>
      <h1>{book.meta.title}</h1>
      <p class="muted">
        {#if book.meta.author}{book.meta.author} · {/if}{book.meta.source.fileName}
        · analysiert in {fmt(loaded.ms)} ms
      </p>
    </div>
  </header>

  <dl class="stats">
    <div><dt>Wörter</dt><dd class="tabular">{fmt(stats.words)}</dd></div>
    <div><dt>Sätze</dt><dd class="tabular">{fmt(stats.sentences)}</dd></div>
    <div><dt>Kapitel</dt><dd class="tabular">{stats.chapters}</dd></div>
    <div><dt>Sprechdauer</dt><dd class="tabular">~{Math.floor(stats.minutes / 60)} h {stats.minutes % 60} min</dd></div>
    <div><dt>Redeteile</dt><dd class="tabular">{fmt(stats.speech)}</dd></div>
    <div><dt>Zur Prüfung</dt><dd class="tabular">{fmt(stats.needsReview)}</dd></div>
  </dl>

  <div class="grid">
    <section class="panel card">
      <h2>Sprecherzuordnung</h2>
      <div class="bar" role="img" aria-label="Verteilung der Zuordnungsverfahren">
        {#each groups as g (g.key)}
          {#if g.n}<span style="flex: {g.n}; background: {g.color}" title="{g.label}: {g.n}"></span>{/if}
        {/each}
      </div>
      <ul class="legend">
        {#each groups as g (g.key)}
          <li>
            <span class="dot" style="background: {g.color}"></span>
            <span><strong>{g.label}</strong> <span class="muted">– {g.hint}</span></span>
            <span class="tabular num">{fmt(g.n)}</span>
            <span class="tabular num muted">{stats.speech ? ((100 * g.n) / stats.speech).toFixed(0) : 0} %</span>
          </li>
        {/each}
      </ul>
      <p class="muted small">
        Die Prüf-Warteschlange zum Korrigieren kommt in der nächsten Ausbaustufe.
      </p>
    </section>

    <section class="panel card">
      <h2>Figuren <span class="muted count">{stats.cast.length}</span></h2>
      <table>
        <thead><tr><th>Figur</th><th class="num">Redeteile</th><th class="num">Wörter</th><th>Farbe</th></tr></thead>
        <tbody>
          {#each castRows as c (c.id)}
            <tr>
              <td>
                <mark class="sp" style="--mark: {markVar(c.color)}; --strong: {strongVar(c.color)}">
                  <span class="badge">{castEntries.get(c.id)?.badge}</span>{c.name}
                </mark>
              </td>
              <td class="num tabular">{fmt(c.lines)}</td>
              <td class="num tabular">{fmt(c.words)}</td>
              <td class="muted">{c.color === null ? "je Kapitel" : MARKER_SLOTS[c.color]?.name}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#if stats.cast.length > 12}
        <button class="link" onclick={() => (showAll = !showAll)}>
          {showAll ? "Weniger anzeigen" : `Alle ${stats.cast.length} Figuren anzeigen`}
        </button>
      {/if}
    </section>
  </div>

  <ChapterPreview {book} />
</article>

<style>
  .book { display: grid; gap: 1.4rem; }
  h1 { font-family: var(--read); font-size: clamp(1.6rem, 3vw, 2.2rem); font-weight: 600; }
  .head p { margin: 0.35rem 0 0; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr)); gap: 0.8rem; margin: 0; }
  .stats div { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 0.7rem 0.9rem; }
  dt { font-size: 0.78rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
  dd { margin: 0.15rem 0 0; font-size: 1.35rem; font-weight: 650; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(22rem, 1fr)); gap: 1.2rem; align-items: start; }
  .card { padding: 1.1rem 1.2rem; }
  .card h2 { font-size: 1rem; margin-bottom: 0.8rem; }
  .count { font-weight: 400; }
  .bar { display: flex; height: 0.7rem; border-radius: 99px; overflow: hidden; gap: 2px; background: var(--line); }
  .legend { list-style: none; padding: 0; margin: 0.9rem 0 0; display: grid; gap: 0.45rem; }
  .legend li { display: grid; grid-template-columns: auto 1fr auto 3rem; gap: 0.6rem; align-items: baseline; font-size: 0.92rem; }
  .dot { width: 0.65rem; height: 0.65rem; border-radius: 50%; display: inline-block; }
  .num { text-align: right; }
  .small { font-size: 0.82rem; margin: 0.9rem 0 0; }
  table { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
  th { text-align: left; font-weight: 600; color: var(--muted); font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em; padding: 0 0.4rem 0.4rem; }
  td { padding: 0.32rem 0.4rem; border-top: 1px solid var(--line); }
  th.num { text-align: right; }
  .link { border: 0; background: none; color: var(--accent); padding: 0.6rem 0 0; }
</style>
