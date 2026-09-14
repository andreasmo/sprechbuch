<script lang="ts">
  import { countAsked, hostOf, openPronunciations } from "@sprechbuch/core";
  import { fmt } from "../labels";
  import { aiDialog, aiRunFor, aiSettings, hasConsent, setConsent, type AiTask } from "../store/ai.svelte";
  import type { BookSession } from "../store/session.svelte";

  let { session, onReview }: { session: BookSession; onReview: () => void } = $props();

  const run = $derived(aiRunFor(session));
  const config = $derived(aiSettings.config);
  const consent = $derived(!!config && (config.local || hasConsent(session.book.id, config)));
  const book = $derived(session.book);

  // Kapitelauswahl für die Sprecherprüfung (1-basiert in der Oberfläche)
  let from = $state(1);
  let to = $state(0);
  let includeSure = $state(false);
  let recheck = $state(false);
  const last = $derived(book.chapters.length);
  const range = $derived({ from: Math.max(1, Math.min(from, last)), to: Math.max(1, Math.min(to || last, last)) });
  const chapters = $derived(Array.from({ length: Math.max(0, range.to - range.from + 1) }, (_, i) => range.from - 1 + i));
  const opts = $derived({ chapters, includeSure, recheck });
  const asked = $derived(countAsked(book, opts));
  const openTerms = $derived(openPronunciations(book).length);

  // Schätzungen nur neu berechnen, wenn sich Buch, Auswahl oder Anbieter ändern
  const estimates = $derived(config
    ? { speakers: run.estimate("speakers", config, opts), cast: run.estimate("cast", config), pronunciation: run.estimate("pronunciation", config) }
    : null);
  const estimate = (task: AiTask) => estimates?.[task] ?? null;
  const cost = (usd: number) => usd.toLocaleString("de-DE", { style: "currency", currency: "USD", minimumFractionDigits: usd < 0.1 ? 3 : 2 });
  const tokens = (n: number) => (n >= 10_000 ? `${fmt(Math.round(n / 1000))} Tsd.` : fmt(n));

  function describe(task: AiTask): string {
    const e = estimate(task);
    if (!e || !config) return "";
    if (!e.requests) return "nichts zu tun";
    const money = config.priceIn + config.priceOut ? ` · ca. ${cost(e.costUsd)}` : "";
    return `${fmt(e.requests)} Anfrage${e.requests === 1 ? "" : "n"} · ca. ${tokens(e.input + e.output)} Token${money}`;
  }

  let selected = $state<Record<string, boolean>>({});
  $effect(() => {
    selected = Object.fromEntries(run.merges.map((m) => [m.from, m.confidence >= 0.8]));
  });
  const name = (id: string) => session.lookup.cast.get(id)?.name ?? id;

  function applyMerges() {
    let n = 0;
    for (const m of run.merges) {
      if (!selected[m.from] || !session.lookup.cast.has(m.from) || !session.lookup.cast.has(m.into)) continue;
      session.apply({ type: "mergeCast", from: m.from, into: m.into });
      n++;
    }
    run.merges = [];
    session.notify(`${fmt(n)} Figur${n === 1 ? "" : "en"} zusammengeführt.`);
  }

  const start = (task: AiTask) => config && consent && void run.start(task, config, opts);
</script>

<section class="panel card ai">
  <div class="card-head">
    <h2>KI-Assistent</h2>
    {#if config}
      <span class="muted small">{config.label} · {config.model}</span>
      <span class="grow"></span>
      <button class="ghost small" onclick={() => (aiDialog.open = true)}>Einstellungen</button>
    {/if}
  </div>

  {#if !config}
    <p class="muted">
      Eine KI kann die unsicheren Sprecherzuordnungen vorab prüfen, doppelte Figuren finden und Aussprachen vorschlagen. Dafür
      brauchst du einen eigenen Zugang (z. B. Anthropic) oder ein Modell auf deinem Rechner (Ollama, LM Studio).
    </p>
    <div><button class="primary" onclick={() => (aiDialog.open = true)}>KI einrichten</button></div>
  {:else}
    {#if config.local}
      <p class="privacy small ok">Läuft lokal ({hostOf(config.baseUrl)}) – der Text bleibt auf diesem Rechner.</p>
    {:else}
      <label class="privacy small" class:needed={!consent}>
        <input type="checkbox" checked={consent} onchange={(e) => setConsent(book.id, config, e.currentTarget.checked)} />
        <span>
          Für dieses Buch erlaube ich, dass Kapiteltext an <strong>{hostOf(config.baseUrl)}</strong> gesendet wird.
          <span class="muted">Bei unveröffentlichten Manuskripten vorher die Vereinbarung mit dem Verlag prüfen.</span>
        </span>
      </label>
    {/if}

    {#if run.running}
      <div class="progress-box">
        <div class="bar"><span style="width: {(100 * run.done) / Math.max(1, run.total)}%"></span></div>
        <p class="small">
          {fmt(run.done)} von {fmt(run.total)} Anfragen{run.active.length ? ` · läuft: ${run.active.join(", ")}` : ""}
          {#if config.priceIn + config.priceOut} · bisher {cost(run.costUsd)}{/if}
        </p>
        <button onclick={() => run.cancel()}>Abbrechen</button>
      </div>
    {:else if run.status === "done" || run.status === "error"}
      <div class="result" class:err={run.status === "error"}>
        {#if run.status === "error"}
          <p><strong>Das hat nicht geklappt:</strong> {run.error}</p>
        {:else if run.task === "speakers" && run.outcome}
          {@const o = run.outcome}
          <p>
            <strong>{fmt(o.asked)} Redeteile eingeschätzt:</strong> {fmt(o.confirmed)} bestätigt, {fmt(o.changed)} geändert,
            {fmt(o.review)} mit Vorschlag zur Prüfung{o.newFigures ? `, ${fmt(o.newFigures)} neue Figuren` : ""}.
          </p>
        {:else if run.task === "pronunciation"}
          <p><strong>{fmt(run.pronunciations)} Aussprachen vorgeschlagen</strong> – in der Tabelle unten als „KI“ markiert, noch nicht geklärt.</p>
        {:else if run.task === "cast" && !run.merges.length}
          <p>Keine doppelten Figuren gefunden.</p>
        {/if}
        {#if run.summary}
          <p class="muted small">
            {fmt(run.summary.usage.input + run.summary.usage.output)} Token{config.priceIn + config.priceOut ? ` · ${cost(run.summary.costUsd)}` : ""}
            {#if run.summary.stopped === "cost"} · an der Kostengrenze angehalten{/if}
            {#if run.summary.stopped === "aborted"} · abgebrochen, bisherige Ergebnisse sind eingearbeitet{/if}
            {#if run.summary.failed} · {fmt(run.summary.failed)} fehlgeschlagen: {run.summary.errors.map((e) => `${e.label}: ${e.message}`).join("; ")}{/if}
          </p>
        {/if}
        {#if run.task === "speakers" && session.queue.length}
          <div><button class="primary" onclick={onReview}>{fmt(session.queue.length)} prüfen</button></div>
        {/if}
      </div>
    {/if}

    {#if run.merges.length && !run.running}
      <div class="merges">
        <p class="small"><strong>Vermutlich dieselbe Person</strong> – auswählen und zusammenführen (rückgängig mit Strg+Z):</p>
        <ul>
          {#each run.merges as m (m.from)}
            <li>
              <label>
                <input type="checkbox" bind:checked={selected[m.from]} />
                <span><strong>{name(m.from)}</strong> → <strong>{name(m.into)}</strong> <span class="muted small">{Math.round(m.confidence * 100)} % · {m.reason}</span></span>
              </label>
            </li>
          {/each}
        </ul>
        <div class="row">
          <button class="primary" onclick={applyMerges} disabled={!Object.values(selected).some(Boolean)}>Ausgewählte zusammenführen</button>
          <button class="ghost" onclick={() => (run.merges = [])}>Verwerfen</button>
        </div>
      </div>
    {/if}

    <div class="tasks" class:locked={!consent || run.running}>
      <div class="task">
        <div>
          <h3>Sprecher prüfen lassen</h3>
          <p class="small muted">
            {fmt(asked)} {includeSure ? "Redeteile" : "unsichere Redeteile"} in Kapitel
            <input type="number" min="1" max={last} bind:value={from} aria-label="von Kapitel" /> bis
            <input type="number" min="1" max={last} value={range.to} oninput={(e) => (to = Number(e.currentTarget.value))} aria-label="bis Kapitel" />
            · {describe("speakers")}
          </p>
          <p class="small options">
            <label><input type="checkbox" bind:checked={includeSure} /> auch sichere Zuordnungen</label>
            <label><input type="checkbox" bind:checked={recheck} /> schon von der KI geprüfte erneut</label>
          </p>
        </div>
        <button class="primary" disabled={!consent || run.running || !asked} onclick={() => start("speakers")}>Prüfen lassen</button>
      </div>
      <div class="task">
        <div>
          <h3>Doppelte Figuren finden</h3>
          <p class="small muted">{fmt(book.cast.length)} Figuren · {describe("cast")} · Vorschläge werden erst nach deiner Auswahl angewendet</p>
        </div>
        <button disabled={!consent || run.running || book.cast.length < 2} onclick={() => start("cast")}>Vorschläge holen</button>
      </div>
      <div class="task">
        <div>
          <h3>Aussprache vorschlagen</h3>
          <p class="small muted">{fmt(openTerms)} offene Wörter · {describe("pronunciation")}</p>
        </div>
        <button disabled={!consent || run.running || !openTerms} onclick={() => start("pronunciation")}>Vorschlagen lassen</button>
      </div>
    </div>
    {#if !consent}<p class="muted small">Erst die Einwilligung oben setzen.</p>{/if}
  {/if}
</section>

<style>
  .card { padding: 1rem 1.2rem; display: grid; gap: 0.75rem; }
  .card-head { display: flex; align-items: baseline; gap: 0.7rem; flex-wrap: wrap; }
  h2 { font-size: 1rem; }
  h3 { font-size: 0.95rem; margin: 0 0 0.15rem; }
  .grow { flex: 1; }
  p { margin: 0; }
  .privacy { display: flex; gap: 0.5rem; align-items: baseline; padding: 0.5rem 0.7rem; border-radius: 8px; background: color-mix(in srgb, var(--fg) 4%, transparent); }
  .privacy.ok { color: var(--ok); }
  .privacy.needed { background: color-mix(in srgb, var(--warn) 12%, transparent); }
  .tasks { display: grid; gap: 0.1rem; }
  .tasks.locked .task > div { opacity: 0.7; }
  .task { display: flex; gap: 1rem; align-items: center; justify-content: space-between; border-top: 1px solid var(--line); padding: 0.6rem 0 0.2rem; }
  .task input[type="number"] { width: 3.6rem; padding: 0.1rem 0.3rem; }
  .options { display: flex; gap: 1rem; flex-wrap: wrap; margin-top: 0.2rem; }
  .options label { display: inline-flex; gap: 0.35rem; align-items: center; color: var(--muted); }
  .progress-box { display: grid; gap: 0.4rem; justify-items: start; }
  .bar { width: 100%; height: 0.4rem; background: var(--line); border-radius: 99px; overflow: hidden; }
  .bar span { display: block; height: 100%; background: var(--accent); transition: width 0.2s; }
  .result { display: grid; gap: 0.4rem; padding: 0.6rem 0.8rem; border-radius: 8px; background: color-mix(in srgb, var(--ok) 9%, transparent); }
  .result.err { background: color-mix(in srgb, var(--danger) 10%, transparent); }
  .merges { display: grid; gap: 0.4rem; }
  .merges ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.2rem; }
  .merges label { display: flex; gap: 0.5rem; align-items: baseline; }
  .row { display: flex; gap: 0.4rem; }
</style>
