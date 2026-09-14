<script lang="ts">
  let { onClose }: { onClose: () => void } = $props();

  /** "Strg+S" = zusammen drücken, "[ / ]" = Alternativen */
  type Row = [combo: string, label: string];
  const alternatives = (combo: string) => combo.split(" / ").map((alt) => (alt === "+" ? ["+"] : alt.split("+")));

  const SECTIONS: { title: string; rows: Row[] }[] = [
    {
      title: "Überall",
      rows: [
        ["Strg+S", "Speichern"],
        ["Strg+⇧+S", "Speichern unter"],
        ["Strg+Z", "Rückgängig"],
        ["Strg+Y", "Wiederholen"],
        ["Strg+F / /", "Im Buch suchen"],
        ["Enter", "In der Suche: nächster Treffer"],
        ["?", "Diese Übersicht"],
      ],
    },
    {
      title: "Aufnehmen",
      rows: [
        ["Leer / → / j", "Nächster Satz"],
        ["⇧+Leer / ← / k", "Satz zurück"],
        ["[ / ]", "Kapitel zurück / vor"],
        ["m", "Seitenmodus ein/aus"],
        ["Bild ↑ / Bild ↓", "Blättern im Seitenmodus"],
        ["1–9", "Figur isolieren (Reihenfolge der Legende)"],
        ["0", "Alle Figuren wieder zeigen"],
        [", / .", "Vorige / nächste Rede der isolierten Figur"],
        ["r", "Retake am Satz"],
        ["b", "Lesezeichen am Satz"],
        ["n", "Notiz zum Satz"],
        ["z", "Aufnahme-Timer starten / anhalten"],
        ["a", "Prompter (Autoscroll)"],
        ["f", "Fokus auf den aktuellen Satz"],
        ["l", "Legende ein/aus"],
        ["t", "Thema wechseln"],
        ["+ / −", "Schrift größer / kleiner"],
      ],
    },
    {
      title: "Prüfen",
      rows: [
        ["Enter", "Zuordnung stimmt"],
        ["1–9", "Andere Figur"],
        ["N / Entf", "Keine direkte Rede"],
        ["V", "Vorschlag der KI übernehmen"],
        ["← / →", "Zurück / überspringen"],
      ],
    },
    {
      title: "Bearbeiten",
      rows: [
        ["Klick", "Auf Rede: Sprecher ändern"],
        ["Auswahl", "Rede, Betonung, Retake, Lesezeichen, Notiz"],
        ["Alt+Klick", "Satz teilen, Pause, Atemzeichen"],
        ["|", "Anklicken: Sätze verbinden"],
        ["⇧+Klick", "In der Legende: Figur abblenden"],
      ],
    },
  ];

  function onKey(ev: KeyboardEvent) {
    // Solange die Hilfe offen ist, lösen Tasten nichts anderes aus
    ev.stopPropagation();
    if (ev.key === "Escape" || ev.key === "?") {
      ev.preventDefault();
      onClose();
    }
  }
</script>

<svelte:window onkeydowncapture={onKey} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onClose}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="dialog panel" role="dialog" aria-modal="true" aria-labelledby="help-title" tabindex="-1" onclick={(e) => e.stopPropagation()}>
    <header>
      <h2 id="help-title">Tastenkürzel</h2>
      <button class="ghost" onclick={onClose} aria-label="Schließen">✕</button>
    </header>
    <div class="cols">
      {#each SECTIONS as s (s.title)}
        <section>
          <h3>{s.title}</h3>
          <table>
            <tbody>
              {#each s.rows as [combo, label] (label)}
                <tr>
                  <td class="keys">{#each alternatives(combo) as keys, a (a)}{#if a}<span class="sep">/</span>{/if}{#each keys as k, i (i)}{#if i}<span class="sep">+</span>{/if}<kbd>{k}</kbd>{/each}{/each}</td>
                  <td>{label}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </section>
      {/each}
    </div>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 70; background: rgb(0 0 0 / 0.4); display: grid; place-items: center; padding: 1rem; }
  .dialog { width: min(58rem, 100%); max-height: 88vh; overflow: auto; padding: 1rem 1.3rem 1.3rem; }
  header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem; }
  h2 { font-size: 1.1rem; }
  h3 { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 0.6rem 0 0.3rem; }
  .cols { columns: 2 22rem; column-gap: 2rem; }
  section { break-inside: avoid; }
  table { border-collapse: collapse; width: 100%; font-size: 0.88rem; }
  td { padding: 0.2rem 0.3rem; border-top: 1px solid var(--line); vertical-align: baseline; }
  .keys { white-space: nowrap; width: 1%; padding-right: 0.8rem; }
  .sep { color: var(--muted); margin: 0 0.18rem; font-size: 0.75rem; }
</style>
