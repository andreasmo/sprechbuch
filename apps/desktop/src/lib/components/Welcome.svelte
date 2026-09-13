<script lang="ts">
  import { readBrowserFile, type FileKind, type PickedFile } from "../platform";

  let { onPick, onDrop, ready }: {
    onPick: (kind: FileKind) => void;
    onDrop: (file: PickedFile) => void;
    ready: boolean;
  } = $props();

  let over = $state(false);

  async function drop(ev: DragEvent) {
    ev.preventDefault();
    over = false;
    const file = ev.dataTransfer?.files?.[0];
    if (file) onDrop(await readBrowserFile(file));
  }
</script>

<section class="welcome">
  <div class="intro">
    <h1>Bücher so aufbereiten, dass man sie laut lesen kann.</h1>
    <p class="muted">
      Sprechbuch erkennt Sätze und direkte Rede, ordnet jede Rede einer Figur zu und markiert sie mit
      einer eigenen Textmarker-Farbe. Das Ergebnis ist eine <strong>.hbook</strong>-Datei, die du
      verschieben, sichern und weitergeben kannst.
    </p>
  </div>

  <div
    class="drop panel"
    class:over
    role="region"
    aria-label="Datei hier ablegen"
    ondragover={(e) => { e.preventDefault(); over = true; }}
    ondragleave={() => (over = false)}
    ondrop={drop}
  >
    <div class="big" aria-hidden="true">📖</div>
    <p><strong>EPUB oder PDF hierher ziehen</strong></p>
    <p class="muted small">oder</p>
    <div class="actions">
      <button class="primary" disabled={!ready} onclick={() => onPick("source")}>Buch importieren …</button>
      <button disabled={!ready} onclick={() => onPick("hbook")}>Sprechbuch öffnen …</button>
    </div>
    <p class="muted small hint">Word-Dateien folgen. Alles bleibt auf deinem Rechner – es wird nichts hochgeladen.</p>
  </div>

  <ul class="features">
    <li><span class="sw" style="--mark: var(--m0)"></span><div><strong>Textmarker pro Figur</strong><br /><span class="muted">buchweit stabil, im Kapitel nie doppelt</span></div></li>
    <li><span class="sw" style="--mark: var(--m1)"></span><div><strong>Satzgrenzen als Pipe |</strong><br /><span class="muted">Atempausen auf einen Blick</span></div></li>
    <li><span class="sw" style="--mark: var(--m2)"></span><div><strong>Flattersatz, keine Trennung</strong><br /><span class="muted">kein zerrissenes Wort beim Lesen</span></div></li>
  </ul>
</section>

<style>
  .welcome { display: grid; gap: 2rem; max-width: 46rem; margin: 2rem auto 0; }
  h1 { font-family: var(--read); font-size: clamp(1.7rem, 3.2vw, 2.4rem); font-weight: 600; letter-spacing: -0.01em; }
  .intro p { font-size: 1.05rem; max-width: 40rem; }
  .drop {
    text-align: center; padding: 2.4rem 1.5rem;
    border: 2px dashed var(--line); box-shadow: none;
    transition: border-color 0.15s, background-color 0.15s;
  }
  .drop.over { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 6%, var(--panel)); }
  .drop p { margin: 0.3rem 0; }
  .big { font-size: 2.2rem; }
  .small { font-size: 0.85rem; }
  .actions { display: flex; gap: 0.6rem; justify-content: center; flex-wrap: wrap; margin: 0.4rem 0 0.8rem; }
  .hint { margin-top: 0.8rem; }
  .features { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: 1rem; }
  .features li { display: flex; gap: 0.7rem; align-items: flex-start; font-size: 0.92rem; }
  .sw { flex: none; width: 1.1rem; height: 1.1rem; margin-top: 0.15rem; border-radius: 0.3rem 0.5rem; background: var(--mark); }
</style>
