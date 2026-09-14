<script lang="ts">
  import { fmt } from "../labels";
  import { baseName } from "../platform";
  import type { BookSession } from "../store/session.svelte";

  let { session }: { session: BookSession } = $props();

  const conflict = $derived(session.conflict);
  const report = $derived(session.mergeReport);
  const when = (iso: string) => new Date(iso).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
  let busy = $state(false);

  async function run(fn: () => unknown) {
    busy = true;
    try {
      await fn();
    } finally {
      busy = false;
    }
  }
</script>

<div class="conflict panel" role="alertdialog" aria-labelledby="conflict-title">
  {#if conflict?.kind === "changed" && conflict.other}
    {@const other = conflict.other}
    {@const otherBook = other.book.id === session.book.id}
    <h2 id="conflict-title">⚠ Die Datei wurde außerhalb von Sprechbuch geändert</h2>
    <p>
      <strong>{baseName(conflict.path)}</strong> wurde inzwischen verändert – vermutlich auf einem anderen Gerät oder
      durch die Cloud-Synchronisierung. Hier gibt es Änderungen, die noch nicht in der Datei stehen.
    </p>
    <ul class="facts small">
      <li>Fassung in der Datei: zuletzt bearbeitet {when(other.book.meta.modifiedAt)}</li>
      <li>Deine Fassung: {conflict.journal ? `${fmt(conflict.journal.length)} Änderung${conflict.journal.length === 1 ? "" : "en"} seit dem gemeinsamen Stand` : "ungespeicherte Änderungen"}</li>
      {#if !otherBook}<li class="warn">In der Datei steht jetzt ein anderes Buch: „{other.book.meta.title}“.</li>{/if}
    </ul>
    <div class="actions">
      {#if conflict.journal}
        <button class="primary" disabled={busy} onclick={() => session.resolveConflict("merge")}
          title="Deine Änderungen werden auf die Fassung aus der Datei übertragen. Bei denselben Stellen gilt deine Entscheidung.">Zusammenführen</button>
      {/if}
      <button disabled={busy} onclick={() => session.resolveConflict("theirs")} title="Deine ungespeicherten Änderungen gehen verloren">Fassung aus der Datei laden</button>
      <button disabled={busy} onclick={() => session.resolveConflict("mine")} title="Die Datei wird beim nächsten Speichern mit deiner Fassung ersetzt">Meine Fassung behalten</button>
      <button class="ghost" disabled={busy} onclick={() => run(() => session.save(true))}>Meine als Kopie speichern …</button>
    </div>
    {#if conflict.journal}
      <p class="muted small hint">Zusammenführen überträgt deine Änderungen auf die neue Fassung; wo beide dieselbe Stelle geändert haben, gilt deine.</p>
    {/if}
  {:else if conflict?.kind === "missing"}
    <h2 id="conflict-title">⚠ Die Datei ist nicht mehr da</h2>
    <p>
      <strong>{conflict.path}</strong> wurde verschoben, umbenannt oder gelöscht. Deine Arbeit ist in Sprechbuch gesichert.
    </p>
    <div class="actions">
      <button class="primary" disabled={busy} onclick={() => run(() => session.save(false, { force: true }))}>Wieder dort speichern</button>
      <button disabled={busy} onclick={() => run(() => session.save(true))}>Speichern unter …</button>
      <button class="ghost" disabled={busy} onclick={() => session.detachFile()}>Ohne Datei weiterarbeiten</button>
    </div>
  {:else if report}
    <h2 id="conflict-title">Zusammengeführt</h2>
    <p>
      {fmt(report.applied)} Änderung{report.applied === 1 ? "" : "en"} übertragen{report.unchanged ? `, ${fmt(report.unchanged)} waren dort schon so` : ""}.
      {session.autosaves ? "Das Ergebnis wird gleich in die Datei geschrieben." : "Mit Strg+S speichern."}
    </p>
    {#if report.skipped.length}
      <p class="small"><strong>Nicht übertragbar</strong> – die Stelle gibt es in der Fassung aus der Datei nicht mehr:</p>
      <ul class="skipped small">
        {#each report.skipped as s, i (i)}<li>{s.label}: <span class="muted">{s.reason}</span></li>{/each}
      </ul>
    {/if}
    <div class="actions"><button class="primary" onclick={() => (session.mergeReport = null)}>OK</button></div>
  {/if}
</div>

<style>
  .conflict {
    position: fixed; top: 4.2rem; left: 50%; transform: translateX(-50%); z-index: 55;
    width: min(42rem, calc(100vw - 2rem)); padding: 1rem 1.2rem;
    display: grid; gap: 0.55rem;
    border-color: color-mix(in srgb, var(--warn) 55%, var(--line));
    box-shadow: 0 10px 40px rgb(0 0 0 / 0.18);
  }
  h2 { font-size: 1.02rem; }
  p { margin: 0; }
  .facts, .skipped { margin: 0; padding-left: 1.1rem; display: grid; gap: 0.15rem; }
  .skipped { max-height: 9rem; overflow: auto; }
  .warn { color: var(--danger); }
  .actions { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.2rem; }
  .hint { margin-top: -0.1rem; }
</style>
