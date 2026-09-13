<script lang="ts">
  import type { ImportStage } from "@sprechbuch/core";

  let { file, stage }: { file: string; stage: ImportStage | null } = $props();

  const STAGES: [ImportStage, string][] = [
    ["read", "Datei lesen"],
    ["sentences", "Sätze erkennen"],
    ["speech", "Direkte Rede finden"],
    ["speakers", "Sprecher zuordnen"],
    ["colors", "Farben vergeben"],
    ["book", "Buchdatei erstellen"],
  ];
  const current = $derived(stage ? STAGES.findIndex(([s]) => s === stage) : -1);
</script>

<section class="progress panel" aria-live="polite">
  <h2>{file}</h2>
  <ol>
    {#each STAGES as [key, label], i (key)}
      <li class:done={i < current} class:active={i === current}>
        <span class="dot" aria-hidden="true">{i < current ? "✓" : i === current ? "●" : "○"}</span>
        {label}
      </li>
    {/each}
  </ol>
</section>

<style>
  .progress { max-width: 30rem; margin: 4rem auto; padding: 1.6rem 1.8rem; }
  h2 { font-size: 1.05rem; margin-bottom: 1rem; word-break: break-all; }
  ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.45rem; }
  li { color: var(--muted); display: flex; gap: 0.6rem; }
  li.done { color: var(--fg); }
  li.active { color: var(--fg); font-weight: 600; }
  .dot { width: 1.2rem; text-align: center; color: var(--accent); }
  li.active .dot { animation: pulse 1s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: 0.35; } }
  @media (prefers-reduced-motion: reduce) { li.active .dot { animation: none; } }
</style>
