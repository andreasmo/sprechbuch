<script lang="ts">
  import { onMount } from "svelte";
  import { isAppleMobile, isStandalone, LESE_APP } from "../edition";
  import { readBrowserFile, type PickedFile } from "../platform";
  import { appUpdate, applyUpdate } from "../pwa.svelte";
  import { deleteBook, listRecent, type RecentEntry } from "../store/persist";

  let { onPick, onDrop, onOpenRecent, ready, dragOver = false }: {
    onPick: () => void;
    onDrop: (file: PickedFile) => void;
    onOpenRecent: (id: string) => void;
    ready: boolean;
    /** Desktop: Datei wird gerade über das Fenster gezogen */
    dragOver?: boolean;
  } = $props();

  let htmlOver = $state(false);
  const over = $derived(htmlOver || dragOver);
  let recent = $state<RecentEntry[]>([]);

  onMount(async () => {
    try {
      recent = await listRecent();
    } catch {
      recent = [];
    }
  });

  async function drop(ev: DragEvent) {
    ev.preventDefault();
    htmlOver = false;
    const file = ev.dataTransfer?.files?.[0];
    if (file) onDrop(await readBrowserFile(file));
  }

  async function forget(id: string) {
    await deleteBook(id);
    recent = recent.filter((r) => r.id !== id);
  }

  const when = (iso: string) => new Date(iso).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
  // Safari löscht Website-Daten nach einiger Zeit ohne Besuch – als App vom Home-Bildschirm nicht
  const installHint = LESE_APP && isAppleMobile() && !isStandalone();
</script>

<section class="start">
  {#if appUpdate.ready}
    <div class="update panel small" role="status">
      Eine neue Version ist bereit.
      <button class="primary small" onclick={applyUpdate}>Jetzt neu laden</button>
    </div>
  {/if}

  <div class="intro">
    {#if LESE_APP}
      <h1>Sprechbuch zum Lesen und Einsprechen.</h1>
      <p class="muted">
        Öffne eine <strong>.hbook</strong>-Datei aus der Sprechbuch-App – etwa aus Dropbox oder iCloud Drive. Lesen, aufnehmen,
        Retakes, Notizen und Sprecher korrigieren geht hier; mit „Sichern“ gibst du die Datei zurück, die Desktop-App übernimmt
        deine Änderungen.
      </p>
    {:else}
      <h1>Bücher so aufbereiten, dass man sie laut lesen kann.</h1>
      <p class="muted">
        Sprechbuch erkennt Sätze und direkte Rede, ordnet jede Rede einer Figur zu und markiert sie mit einer eigenen
        Textmarker-Farbe. Du prüfst, korrigierst und liest direkt daraus ein. Gespeichert wird alles in einer
        <strong>.hbook</strong>-Datei.
      </p>
    {/if}
  </div>

  {#if installHint}
    <p class="install panel small">
      <strong>Tipp:</strong> Über <span aria-hidden="true">⎙</span> „Teilen“ → „Zum Home-Bildschirm“ wird Sprechbuch zur App: Sie startet
      ohne Browserleiste, funktioniert ohne Internet, und Safari löscht deine Bücher nicht nach einigen Tagen ohne Besuch.
    </p>
  {/if}

  <div
    class="drop panel"
    class:over
    role="region"
    aria-label="Datei hier ablegen"
    ondragover={(e) => { e.preventDefault(); htmlOver = true; }}
    ondragleave={() => (htmlOver = false)}
    ondrop={drop}
  >
    <div class="big" aria-hidden="true">📖</div>
    <p><strong>{LESE_APP ? ".hbook-Datei hierher ziehen" : "EPUB, PDF oder .hbook hierher ziehen"}</strong></p>
    <div class="actions">
      <button class="primary" disabled={!ready} onclick={onPick}>{LESE_APP ? "Sprechbuch-Datei öffnen …" : "Datei öffnen …"}</button>
    </div>
    <p class="muted small">
      {LESE_APP
        ? "Das Buch bleibt auf diesem Gerät – es wird nichts hochgeladen, die Seite kann technisch nichts nach außen senden."
        : "Word-Dateien folgen. Alles bleibt auf deinem Rechner – es wird nichts hochgeladen."}
    </p>
  </div>

  {#if recent.length}
    <section class="recent">
      <h2>Zuletzt bearbeitet</h2>
      <ul>
        {#each recent as r (r.id)}
          <li class="panel">
            <button class="open ghost" onclick={() => onOpenRecent(r.id)}>
              <span class="title">{r.title}</span>
              <span class="muted small">
                {r.author ? `${r.author} · ` : ""}{when(r.updatedAt)}{r.progress ? ` · gelesen bis ${r.progress} %` : ""}
              </span>
              <span class="small file">
                {#if r.dirty}<span class="unsaved">● {LESE_APP ? "Änderungen noch nicht gesichert" : "nicht als .hbook gespeichert"}</span>{:else if r.savedPath}<span class="muted">{r.savedPath}</span>{/if}
              </span>
            </button>
            <button class="ghost forget" title="Aus der Liste entfernen (die .hbook-Datei bleibt erhalten)" aria-label="Aus der Liste entfernen" onclick={() => forget(r.id)}>✕</button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</section>

<style>
  .start { display: grid; gap: 1.8rem; max-width: 46rem; margin: 1.5rem auto 0; }
  h1 { font-family: var(--read); font-size: clamp(1.7rem, 3.2vw, 2.4rem); font-weight: 600; letter-spacing: -0.01em; }
  .intro p { font-size: 1.02rem; }
  .drop {
    text-align: center; padding: 2rem 1.5rem;
    border: 2px dashed var(--line); box-shadow: none;
    transition: border-color 0.15s, background-color 0.15s;
  }
  .drop.over { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 6%, var(--panel)); }
  .drop p { margin: 0.3rem 0; }
  .big { font-size: 2.2rem; }
  .actions { margin: 0.8rem 0; }
  .recent h2 { font-size: 1rem; margin-bottom: 0.6rem; }
  .recent ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.5rem; }
  .recent li { display: flex; align-items: stretch; box-shadow: none; }
  .open { flex: 1; display: grid; gap: 0.1rem; text-align: left; padding: 0.7rem 0.9rem; white-space: normal; border-radius: var(--radius) 0 0 var(--radius); }
  .title { font-weight: 650; font-size: 1.02rem; }
  .file { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .unsaved { color: var(--warn); }
  .forget { padding: 0 0.9rem; color: var(--muted); border-radius: 0 var(--radius) var(--radius) 0; }
  .install { margin: 0; padding: 0.7rem 0.9rem; box-shadow: none; background: color-mix(in srgb, var(--accent) 6%, var(--panel)); }
  .update { display: flex; align-items: center; justify-content: space-between; gap: 0.8rem; padding: 0.5rem 0.8rem; box-shadow: none; }
</style>
