<script lang="ts">
  import { LONG_SENTENCE } from "../render";
  import { resetSettings, settings, THEMES, type ReadFont } from "../store/settings.svelte";

  const FONTS: [ReadFont, string][] = [["serif", "Serif"], ["sans", "Serifenlos"], ["legible", "Gut lesbar"], ["mono", "Monospace"]];

  const TOGGLES: { key: "badges" | "pipes" | "breath" | "warnLong" | "numbers" | "dimRead" | "focus" | "preview" | "legend"; label: string; hint?: string }[] = [
    { key: "badges", label: "Sprecher-Kürzel an der Rede" },
    { key: "pipes", label: "Pipes | statt Satzpunkten" },
    { key: "breath", label: "Atemstellen an Kommata", hint: "Komma, Semikolon, Doppelpunkt, Gedankenstrich" },
    { key: "warnLong", label: "Lange Sätze markieren", hint: `mehr als ${LONG_SENTENCE} Wörter` },
    { key: "numbers", label: "Satznummern" },
    { key: "dimRead", label: "Gelesenes abblenden", hint: "Aufnehmen" },
    { key: "focus", label: "Fokus auf den aktuellen Satz", hint: "Aufnehmen" },
    { key: "preview", label: "Vorschau „Als Nächstes“", hint: "Aufnehmen" },
    { key: "legend", label: "Figurenlegende", hint: "Aufnehmen" },
  ];
</script>

<div class="settings">
  <h4>Darstellung</h4>
  <div class="grid">
    <label for="vs-theme">Thema</label>
    <select id="vs-theme" bind:value={settings.theme}>
      {#each THEMES as [t, label] (t)}<option value={t}>{label}</option>{/each}
    </select>
    <span></span>

    <label for="vs-font">Schrift</label>
    <select id="vs-font" bind:value={settings.font}>
      {#each FONTS as [f, label] (f)}<option value={f}>{label}</option>{/each}
    </select>
    <span></span>

    <label for="vs-size">Größe</label>
    <input id="vs-size" type="range" min="14" max="44" step="1" bind:value={settings.fontSize} />
    <span class="val tabular">{settings.fontSize} px</span>

    <label for="vs-lh">Zeilenabstand</label>
    <input id="vs-lh" type="range" min="1.3" max="2.6" step="0.05" bind:value={settings.lineHeight} />
    <span class="val tabular">{settings.lineHeight.toFixed(2)}</span>

    <label for="vs-colw">Spaltenbreite</label>
    <input id="vs-colw" type="range" min="24" max="60" step="1" bind:value={settings.columnWidth} />
    <span class="val tabular">{settings.columnWidth} rem</span>

    <label for="vs-ws">Wortabstand</label>
    <input id="vs-ws" type="range" min="0" max="0.5" step="0.02" bind:value={settings.wordSpacing} />
    <span class="val tabular">+{settings.wordSpacing.toFixed(2)} em</span>

    <label for="vs-speech">Direkte Rede</label>
    <select id="vs-speech" bind:value={settings.speech}>
      <option value="marker">Textmarker</option>
      <option value="underline">Unterstrichen</option>
      <option value="off">ohne Farbe</option>
    </select>
    <span></span>
  </div>

  <ul class="toggles">
    {#each TOGGLES as t (t.key)}
      <li>
        <label>
          <input type="checkbox" bind:checked={settings[t.key]} />
          <span>{t.label}{#if t.hint}<span class="muted small">{` · ${t.hint}`}</span>{/if}</span>
        </label>
      </li>
    {/each}
  </ul>
  <div class="foot">
    <span class="muted small">Gilt für dieses Gerät, nicht für die Buchdatei.</span>
    <button class="ghost small" onclick={resetSettings}>Zurücksetzen</button>
  </div>
</div>

<style>
  .settings { display: grid; gap: 0.6rem; }
  h4 { margin: 0; font-size: 0.92rem; }
  .grid { display: grid; grid-template-columns: auto 1fr 4.6rem; gap: 0.4rem 0.6rem; align-items: center; }
  .grid label { color: var(--muted); font-size: 0.85rem; }
  .grid select { width: 100%; }
  .val { font-size: 0.8rem; color: var(--muted); text-align: right; }
  .toggles { list-style: none; margin: 0; padding: 0.5rem 0 0; border-top: 1px solid var(--line); display: grid; gap: 0.15rem; }
  .toggles label { display: flex; gap: 0.5rem; align-items: baseline; cursor: pointer; padding: 0.1rem 0; }
  .foot { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; border-top: 1px solid var(--line); padding-top: 0.5rem; }
</style>
