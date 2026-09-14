<script lang="ts">
  import { MARKER_SLOTS } from "@sprechbuch/core";
  import { duration, fmt } from "../labels";
  import { markVar, strongVar } from "../markers";
  import type { MarkRow } from "../marks";
  import type { BookSession } from "../store/session.svelte";
  import AiPanel from "./AiPanel.svelte";
  import MarksList from "./MarksList.svelte";
  import Popover from "./Popover.svelte";

  let { session, onReview, onRecordAt, onShowInText }: {
    session: BookSession;
    onReview: () => void;
    onRecordAt: (row: MarkRow) => void;
    onShowInText: (row: MarkRow) => void;
  } = $props();

  const book = $derived(session.book);
  const stats = $derived(session.stats);

  const GROUPS = [
    { key: "sure", label: "sicher", hint: "Inquit direkt an der Rede", vias: ["inquit_after", "inquit_before"], color: "var(--ok)" },
    { key: "user", label: "von dir", hint: "geprüft oder gesetzt", vias: ["user"], color: "var(--accent)" },
    { key: "llm", label: "KI", hint: "von der KI zugeordnet", vias: ["llm"], color: "color-mix(in srgb, var(--ok) 55%, var(--accent))" },
    { key: "derived", label: "abgeleitet", hint: "Absatz, Pronomen, Fortsetzung", vias: ["same_paragraph", "continuation", "pronoun", "inquit_paragraph"], color: "color-mix(in srgb, var(--accent) 45%, var(--muted))" },
    { key: "guessed", label: "geraten", hint: "Nähe, Wechselrede", vias: ["proximity", "alternation"], color: "var(--warn)" },
    { key: "open", label: "offen", hint: "keine Figur", vias: ["unknown"], color: "var(--danger)" },
  ];
  const groups = $derived(GROUPS.map((g) => ({ ...g, n: g.vias.reduce((s, v) => s + (stats.byVia[v] ?? 0), 0) })));

  let showAllCast = $state(false);
  let showAllPron = $state(false);
  let newName = $state("");
  let colorPop = $state<{ id: string; x: number; y: number } | null>(null);

  const rows = $derived(showAllCast ? stats.cast : stats.cast.slice(0, 15));
  const entry = (id: string) => session.lookup.cast.get(id)!;

  let mergePop = $state<{ from: string; into: string; x: number; y: number } | null>(null);

  const KIND: Record<string, string> = { figure: "Figur", name: "Name", long: "lang", foreign: "fremd" };
  const pron = $derived(showAllPron ? book.pronunciations : book.pronunciations.slice(0, 20));
</script>

<article class="overview">
  <header>
    <h1>{book.meta.title}</h1>
    <p class="muted">{book.meta.author ? `${book.meta.author} · ` : ""}Quelle: {book.meta.source.fileName}</p>
  </header>

  <dl class="stats">
    <div><dt>Wörter</dt><dd class="tabular">{fmt(stats.words)}</dd></div>
    <div><dt>Sätze</dt><dd class="tabular">{fmt(stats.sentences)}</dd></div>
    <div><dt>Kapitel</dt><dd class="tabular">{stats.chapters}</dd></div>
    <div><dt>Sprechdauer</dt><dd class="tabular">~{duration(stats.minutes)}</dd></div>
    <div><dt>Redeteile</dt><dd class="tabular">{fmt(stats.speech)}</dd></div>
    <div class:attention={stats.needsReview > 0}><dt>Zur Prüfung</dt><dd class="tabular">{fmt(stats.needsReview)}</dd></div>
  </dl>

  <section class="panel card">
    <div class="card-head">
      <h2>Sprecherzuordnung</h2>
      {#if stats.needsReview}<button class="primary" onclick={onReview}>{fmt(stats.needsReview)} prüfen</button>{/if}
    </div>
    <div class="bar" role="img" aria-label="Verteilung der Zuordnungsverfahren">
      {#each groups as g (g.key)}{#if g.n}<span style="flex: {g.n}; background: {g.color}" title="{g.label}: {g.n}"></span>{/if}{/each}
    </div>
    <ul class="legend">
      {#each groups as g (g.key)}
        {#if g.n || (g.key !== "user" && g.key !== "llm")}
          <li>
            <span class="dot" style="background: {g.color}"></span>
            <span><strong>{g.label}</strong> <span class="muted">– {g.hint}</span></span>
            <span class="tabular num">{fmt(g.n)}</span>
            <span class="tabular num muted">{stats.speech ? Math.round((100 * g.n) / stats.speech) : 0} %</span>
          </li>
        {/if}
      {/each}
    </ul>
  </section>

  <AiPanel {session} {onReview} />

  <section class="panel card">
    <div class="card-head">
      <h2>Figuren <span class="muted count">{stats.cast.length}</span></h2>
      <form class="add" onsubmit={(e) => { e.preventDefault(); if (newName.trim()) { session.apply({ type: "addCast", name: newName }); newName = ""; } }}>
        <input bind:value={newName} placeholder="Neue Figur" aria-label="Name der neuen Figur" />
        <button type="submit" disabled={!newName.trim()}>Anlegen</button>
      </form>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Farbe</th><th>Name</th><th>Kürzel</th><th>Stimme</th><th class="num">Rede</th><th class="num">Wörter</th><th>Zusammenführen</th></tr>
        </thead>
        <tbody>
          {#each rows as r (r.id)}
            {@const c = entry(r.id)}
            {#if c}
              <tr>
                <td>
                  <button class="ghost colorbtn" onclick={(e) => (colorPop = { id: c.id, x: e.clientX, y: e.clientY })}
                    title={c.color === null ? "Farbe je Kapitel" : MARKER_SLOTS[c.color]?.name}>
                    <span class="swatch" style="--mark: {markVar(c.color)}; --strong: {strongVar(c.color)}"></span>
                    <span class="small muted">{c.color === null ? "je Kap." : MARKER_SLOTS[c.color]?.name}</span>
                  </button>
                </td>
                <td><input class="name" value={c.name} aria-label="Name"
                  onchange={(e) => e.currentTarget.value.trim() && e.currentTarget.value !== c.name && session.apply({ type: "updateCast", id: c.id, name: e.currentTarget.value })} />
                  {#if c.aliases.length}<div class="muted small aliases" title={c.aliases.join(", ")}>auch: {c.aliases.join(", ")}</div>{/if}
                </td>
                <td><input class="badge-in" value={c.badge} maxlength="3" aria-label="Kürzel"
                  onchange={(e) => session.apply({ type: "updateCast", id: c.id, badge: e.currentTarget.value })} /></td>
                <td><input class="voice" value={c.voiceNote} placeholder="z. B. tief, ruhig" aria-label="Stimmnotiz"
                  onchange={(e) => session.apply({ type: "updateCast", id: c.id, voiceNote: e.currentTarget.value })} /></td>
                <td class="num tabular">{fmt(r.lines)}</td>
                <td class="num tabular">{fmt(r.words)}</td>
                <td>
                  <select aria-label="Zusammenführen mit" value="" onchange={(e) => { const v = e.currentTarget.value; const r = e.currentTarget.getBoundingClientRect(); e.currentTarget.value = ""; if (v) mergePop = { from: c.id, into: v, x: r.left + r.width / 2, y: r.bottom }; }}>
                    <option value="">…</option>
                    {#each stats.cast.filter((o) => o.id !== c.id) as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
                  </select>
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
    {#if stats.cast.length > 15}
      <button class="ghost more" onclick={() => (showAllCast = !showAllCast)}>{showAllCast ? "Weniger anzeigen" : `Alle ${stats.cast.length} Figuren`}</button>
    {/if}
  </section>

  {#if book.pronunciations.length}
    <section class="panel card">
      <h2>Aussprache klären <span class="muted count">{book.pronunciations.filter((p) => p.verified).length} / {book.pronunciations.length} geklärt</span></h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Wort</th><th>Art</th><th class="num">Vorkommen</th><th>Aussprache</th><th>Geklärt</th></tr></thead>
          <tbody>
            {#each pron as p (p.term)}
              <tr class:verified={p.verified}>
                <td><strong>{p.term}</strong>{#if p.origin === "llm" && !p.verified}<span class="ai-tag" title="Vorschlag der KI – bitte prüfen">KI</span>{/if}</td>
                <td class="muted small">{KIND[p.kind] ?? p.kind}</td>
                <td class="num tabular">{fmt(p.count)}</td>
                <td><input value={p.hint} placeholder="z. B. Ko-ba-LA-ba" aria-label="Aussprache von {p.term}"
                  onchange={(e) => session.apply({ type: "updatePronunciation", term: p.term, hint: e.currentTarget.value })} /></td>
                <td><input type="checkbox" checked={p.verified} aria-label="{p.term} geklärt"
                  onchange={(e) => session.apply({ type: "updatePronunciation", term: p.term, verified: e.currentTarget.checked })} /></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#if book.pronunciations.length > 20}
        <button class="ghost more" onclick={() => (showAllPron = !showAllPron)}>{showAllPron ? "Weniger anzeigen" : `Alle ${book.pronunciations.length} Wörter`}</button>
      {/if}
    </section>
  {/if}

  <MarksList {session} {onRecordAt} {onShowInText} />
</article>

{#if colorPop}
  {@const c = entry(colorPop.id)}
  <Popover x={colorPop.x} y={colorPop.y} onClose={() => (colorPop = null)} width={17}>
    <p class="small muted pop-title">Farbe für {c?.name} – ist sie vergeben, wird getauscht.</p>
    <div class="palette">
      {#each MARKER_SLOTS as s, i (s.name)}
        {@const holder = session.book.cast.find((x) => x.color === i)}
        <button class="ghost" class:active={c?.color === i} title={holder ? `${s.name} – bisher ${holder.name}` : s.name}
          onclick={() => { session.apply({ type: "setCastColor", id: colorPop!.id, color: i }); colorPop = null; }}>
          <span class="swatch big" style="--mark: {markVar(i)}; --strong: {strongVar(i)}"></span>
        </button>
      {/each}
    </div>
    <button class="ghost wide" onclick={() => { session.apply({ type: "setCastColor", id: colorPop!.id, color: null }); colorPop = null; }}>Keine feste Farbe (je Kapitel)</button>
  </Popover>
{/if}

{#if mergePop}
  {@const from = entry(mergePop.from)}
  {@const into = entry(mergePop.into)}
  <Popover x={mergePop.x} y={mergePop.y} onClose={() => (mergePop = null)} width={20}>
    <p class="pop-title"><strong>„{from?.name}“ mit „{into?.name}“ zusammenführen?</strong></p>
    <p class="small muted pop-title">
      Alle Redeteile von {from?.name} gehören danach zu {into?.name}; der Name wird Alias. Rückgängig mit <kbd>Strg</kbd>+<kbd>Z</kbd>.
    </p>
    <div class="confirm-row">
      <button class="primary" onclick={() => { session.apply({ type: "mergeCast", from: mergePop!.from, into: mergePop!.into }); mergePop = null; }}>Zusammenführen</button>
      <button onclick={() => (mergePop = null)}>Abbrechen</button>
    </div>
  </Popover>
{/if}

<style>
  .confirm-row { display: flex; gap: 0.4rem; }
  .overview { display: grid; gap: 1.2rem; }
  h1 { font-family: var(--read); font-size: clamp(1.6rem, 3vw, 2.2rem); font-weight: 600; }
  header p { margin: 0.3rem 0 0; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr)); gap: 0.8rem; margin: 0; }
  .stats div { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 0.7rem 0.9rem; }
  .stats div.attention { border-color: color-mix(in srgb, var(--warn) 60%, var(--line)); }
  dt { font-size: 0.75rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
  dd { margin: 0.15rem 0 0; font-size: 1.35rem; font-weight: 650; }
  .card { padding: 1rem 1.2rem; display: grid; gap: 0.8rem; }
  .card-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
  h2 { font-size: 1rem; }
  .count { font-weight: 400; }
  .bar { display: flex; height: 0.7rem; border-radius: 99px; overflow: hidden; gap: 2px; background: var(--line); }
  .legend { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.4rem; }
  .legend li { display: grid; grid-template-columns: auto 1fr 4rem 3rem; gap: 0.6rem; align-items: baseline; font-size: 0.92rem; }
  .dot { width: 0.65rem; height: 0.65rem; border-radius: 50%; display: inline-block; }
  .num { text-align: right; }
  .add { display: flex; gap: 0.4rem; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
  th { text-align: left; font-weight: 600; color: var(--muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; padding: 0 0.4rem 0.4rem; white-space: nowrap; }
  td { padding: 0.3rem 0.4rem; border-top: 1px solid var(--line); vertical-align: middle; }
  td input { width: 100%; min-width: 0; }
  .name { min-width: 9rem; font-weight: 600; }
  .badge-in { width: 3.4rem; text-align: center; }
  .voice { min-width: 9rem; }
  .aliases { max-width: 16rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 0.15rem; }
  .colorbtn { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.2rem 0.4rem; }
  tr.verified td { opacity: 0.6; }
  .more { justify-self: start; color: var(--accent); }
  .pop-title { margin: 0 0 0.5rem; }
  .palette { display: grid; grid-template-columns: repeat(6, 1fr); gap: 0.2rem; }
  .palette button { padding: 0.35rem; display: grid; place-items: center; }
  .palette button.active { box-shadow: inset 0 0 0 2px var(--accent); }
  .swatch.big { width: 1.5rem; height: 1.5rem; }
  .wide { width: 100%; margin-top: 0.4rem; }
  .ai-tag { margin-left: 0.4rem; font: 700 0.62rem/1 var(--ui); padding: 0.12rem 0.3rem; border-radius: 0.25rem; background: color-mix(in srgb, var(--accent) 15%, transparent); color: var(--accent); vertical-align: 0.1rem; }
</style>
