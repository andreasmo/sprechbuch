<script lang="ts">
  import {
    configFromPreset, hostOf, isLocalUrl, LlmClient, LOCAL_CONTEXT_TOKENS, normalizeBaseUrl, presetById, PRESETS, type ProviderConfig,
  } from "@sprechbuch/core";
  import { onMount } from "svelte";
  import { fmt } from "../labels";
  import type { AiKeyStatus, Platform } from "../platform";
  import { aiPolicy, aiSettings, defaultConfig, recordSpeed, refreshPolicy, setAllowCloud, speedFor } from "../store/ai.svelte";

  let { platform, onClose }: { platform: Platform; onClose: () => void } = $props();

  // Entwurf – übernommen wird erst mit „Speichern“
  let draft = $state<ProviderConfig>({ ...(aiSettings.config ?? defaultConfig()) });
  let maxCost = $state(aiSettings.maxCostUsd);
  let keyInput = $state("");
  let keyStatus = $state<AiKeyStatus | null>(null);
  let replacingKey = $state(false);
  let models = $state<string[]>([]);
  let busy = $state<"" | "key" | "models" | "test" | "policy">("");
  let message = $state<{ ok: boolean; text: string } | null>(null);

  const preset = $derived(presetById(draft.preset));
  const presetModel = $derived(preset?.models.find((m) => m.id === draft.model));
  const keyMismatch = $derived(!!keyStatus && normalizeBaseUrl(keyStatus.baseUrl) !== normalizeBaseUrl(draft.baseUrl));
  const insecureHttp = $derived(draft.baseUrl.startsWith("http://") && !isLocalUrl(draft.baseUrl));
  const localUrl = $derived(isLocalUrl(draft.baseUrl));
  const blocked = $derived(!!draft.baseUrl && !localUrl && !aiPolicy.allowCloud);
  const speed = $derived(localUrl && draft.model ? speedFor({ ...draft, baseUrl: normalizeBaseUrl(draft.baseUrl, draft.kind) }) : null);
  const perSecond = (n: number) => n.toLocaleString("de-DE", { maximumFractionDigits: n < 10 ? 1 : 0 });

  async function refreshKey() {
    keyStatus = draft.needsKey ? await platform.ai.keyStatus(draft.preset).catch(() => null) : null;
    replacingKey = false;
    keyInput = "";
  }
  onMount(() => {
    void refreshKey();
    void refreshPolicy(platform);
    // Ollama meldet seine Modelle von selbst – gleich das erste vorschlagen
    if (draft.kind === "ollama" && !draft.model) void loadModels(true);
  });

  async function toggleCloud(box: HTMLInputElement) {
    const allow = !box.checked;
    busy = "policy";
    message = null;
    try {
      const now = await setAllowCloud(platform, allow);
      if (allow && !now) message = { ok: true, text: "Es bleibt bei „Nur lokale KI“." };
    } catch (err) {
      message = { ok: false, text: err instanceof Error ? err.message : String(err) };
    } finally {
      // Abgelehnt: Der Stand hat sich nicht geändert, das Häkchen muss trotzdem zurück
      box.checked = !aiPolicy.allowCloud;
      busy = "";
    }
  }

  function choosePreset(id: string) {
    const p = presetById(id);
    if (!p) return;
    draft = configFromPreset(p);
    models = [];
    message = null;
    void refreshKey();
    if (p.kind === "ollama") void loadModels(true);
  }

  function chooseModel(id: string) {
    draft.model = id;
    const m = preset?.models.find((x) => x.id === id);
    if (m) {
      draft.priceIn = m.priceIn;
      draft.priceOut = m.priceOut;
    }
  }

  async function saveKey() {
    busy = "key";
    message = null;
    try {
      await platform.ai.setKey(draft.preset, normalizeBaseUrl(draft.baseUrl), keyInput);
      await refreshKey();
      message = { ok: true, text: "Schlüssel gespeichert." };
    } catch (err) {
      message = { ok: false, text: err instanceof Error ? err.message : String(err) };
    } finally {
      busy = "";
    }
  }

  async function deleteKey() {
    await platform.ai.deleteKey(draft.preset);
    await refreshKey();
    message = { ok: true, text: "Schlüssel entfernt." };
  }

  async function loadModels(quiet = false) {
    if (blocked) return;
    busy = "models";
    if (!quiet) message = null;
    try {
      models = await new LlmClient({ ...draft, model: draft.model || "-" }, platform.ai.transport).listModels();
      if (!models.length) {
        message = {
          ok: false,
          text: draft.kind === "ollama" ? "Ollama hat noch kein Modell – im Terminal z. B. „ollama pull gemma4:26b“ ausführen." : "Der Anbieter hat keine Modelle gemeldet.",
        };
      } else if (!models.includes(draft.model) && !presetModel) draft.model = models[0]!;
    } catch (err) {
      message = { ok: false, text: err instanceof Error ? err.message : String(err) };
    } finally {
      busy = "";
    }
  }

  async function test() {
    busy = "test";
    message = null;
    const t0 = performance.now();
    try {
      const config = { ...draft, baseUrl: normalizeBaseUrl(draft.baseUrl, draft.kind), local: isLocalUrl(draft.baseUrl) };
      const client = new LlmClient(config, platform.ai.transport);
      const res = await client.test();
      const secs = ((performance.now() - t0) / 1000).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      const downgraded = client.structured !== draft.structured ? ` Strukturierte Antworten: „${client.structured === "json" ? "JSON-Modus" : "nur Anweisung"}“.` : "";
      if (client.structured !== draft.structured) draft.structured = client.structured;
      let details = "";
      if (config.local) {
        recordSpeed(config, res.timing);
        const measured = speedFor(config);
        if (measured && res.timing?.promptMs) details += ` Liest ca. ${perSecond(measured.promptTps)} Token/s, schreibt ca. ${perSecond(measured.outputTps)} Token/s.`;
        const max = client.modelInfo?.contextLength;
        if (max && draft.contextTokens && max < draft.contextTokens) {
          draft.contextTokens = max;
          details += ` Das Modell kann höchstens ${fmt(max)} Token Kontext – eingestellt.`;
        }
      }
      message = { ok: true, text: `Verbindung steht – Antwort nach ${secs} s.${details}${downgraded}` };
    } catch (err) {
      message = { ok: false, text: err instanceof Error ? err.message : String(err) };
    } finally {
      busy = "";
    }
  }

  function save() {
    const local = isLocalUrl(draft.baseUrl);
    aiSettings.config = {
      ...draft,
      baseUrl: normalizeBaseUrl(draft.baseUrl, draft.kind),
      local,
      ...(local ? { contextTokens: Math.max(4096, Number(draft.contextTokens) || LOCAL_CONTEXT_TOKENS) } : {}),
    };
    aiSettings.maxCostUsd = Math.max(0, Number(maxCost) || 0);
    onClose();
  }

  function disable() {
    aiSettings.config = null;
    onClose();
  }

  function onKey(ev: KeyboardEvent) {
    if (ev.key === "Escape") {
      ev.stopPropagation();
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
  <div class="dialog panel" role="dialog" aria-modal="true" aria-labelledby="ai-title" tabindex="-1" onclick={(e) => e.stopPropagation()}>
    <header>
      <h2 id="ai-title">KI einrichten</h2>
      <button class="ghost" onclick={onClose} aria-label="Schließen">✕</button>
    </header>
    <p class="muted small intro">
      Sprechbuch funktioniert ohne KI. Mit KI werden unsichere Sprecherzuordnungen geprüft, doppelte Figuren gefunden und
      Aussprachen vorgeschlagen – am besten mit einem Modell auf deinem Rechner (Ollama, LM Studio), dann bleibt der Text hier.
    </p>

    <div class="policy" class:cloud={aiPolicy.allowCloud}>
      <label>
        <input type="checkbox" checked={!aiPolicy.allowCloud} disabled={busy === "policy"} onchange={(e) => void toggleCloud(e.currentTarget)} />
        <span><strong>Nur lokale KI</strong> – Buchtext verlässt diesen Rechner bzw. das lokale Netz nie.</span>
      </label>
      <p class="small muted">
        {#if aiPolicy.allowCloud}
          Cloud-KI ist auf diesem Gerät erlaubt – jedes Buch braucht trotzdem eine eigene Einwilligung.
        {:else}
          Empfohlen für unveröffentlichte Manuskripte.{platform.kind === "tauri" ? " Die Sperre sitzt in der App selbst, nicht nur in dieser Oberfläche." : ""}
        {/if}
      </p>
    </div>

    <div class="grid">
      <label for="ai-preset">Anbieter</label>
      <select id="ai-preset" value={draft.preset} onchange={(e) => choosePreset(e.currentTarget.value)}>
        {#each PRESETS as p (p.id)}
          {@const locked = !p.local && p.id !== "custom" && !aiPolicy.allowCloud}
          <option value={p.id} disabled={locked}>{p.label}{locked ? " – gesperrt" : ""}</option>
        {/each}
      </select>
      {#if preset}<p class="hint muted small">{preset.hint}</p>{/if}

      <label for="ai-url">Adresse</label>
      <input id="ai-url" bind:value={draft.baseUrl} placeholder={draft.kind === "ollama" ? "http://localhost:11434" : "https://…/v1"} spellcheck="false" />
      <p class="hint small" class:warn={insecureHttp || blocked}>
        {#if blocked}Gesperrt: {hostOf(draft.baseUrl)} ist keine lokale Adresse, und „Nur lokale KI“ ist eingeschaltet.
        {:else if insecureHttp}Unverschlüsseltes HTTP geht nur zu diesem Rechner oder ins lokale Netz.
        {:else if localUrl}Läuft lokal – der Text verlässt diesen Rechner bzw. das lokale Netz nicht.
        {:else if draft.baseUrl}Buchtext geht an <strong>{hostOf(draft.baseUrl)}</strong>.{/if}
      </p>

      {#if draft.needsKey}
        <span class="label">Schlüssel</span>
        <div>
          {#if keyStatus && !replacingKey}
            <div class="row">
              <span class="ok">✓ gespeichert (…{keyStatus.hint})</span>
              <button class="ghost small" onclick={() => (replacingKey = true)}>Ersetzen</button>
              <button class="ghost small danger" onclick={deleteKey}>Entfernen</button>
            </div>
          {:else}
            <form class="row" onsubmit={(e) => { e.preventDefault(); void saveKey(); }}>
              <input type="password" bind:value={keyInput} placeholder="Schlüssel einfügen" autocomplete="off" spellcheck="false" aria-label="API-Schlüssel" />
              <button type="submit" disabled={!keyInput.trim() || busy === "key"}>Speichern</button>
            </form>
          {/if}
        </div>
        <p class="hint muted small" class:warn={keyMismatch}>
          {#if keyMismatch && keyStatus}Der gespeicherte Schlüssel gilt für {keyStatus.baseUrl} – für die neue Adresse bitte neu speichern.
          {:else if platform.ai.keyStorage === "os"}Liegt im Schlüsselspeicher des Betriebssystems und wird nur an diese Adresse geschickt.
          {:else}Web-Version: nur bis zum Schließen der Seite im Speicher, nirgends abgelegt.{/if}
        </p>
      {/if}

      <label for="ai-model">Modell</label>
      <div class="row">
        {#if preset?.models.length}
          <select id="ai-model" value={presetModel ? draft.model : "__other"} onchange={(e) => chooseModel(e.currentTarget.value === "__other" ? "" : e.currentTarget.value)}>
            {#each preset.models as m (m.id)}<option value={m.id}>{m.label}</option>{/each}
            <option value="__other">anderes …</option>
          </select>
          {#if !presetModel}<input bind:value={draft.model} placeholder="Modell-ID" spellcheck="false" aria-label="Modell-ID" />{/if}
        {:else}
          <input id="ai-model" bind:value={draft.model} list="ai-models" placeholder="Modell-ID" spellcheck="false" />
          <datalist id="ai-models">{#each models as m (m)}<option value={m}></option>{/each}</datalist>
        {/if}
        <button class="ghost small" onclick={() => loadModels()} disabled={busy === "models" || !draft.baseUrl || blocked}>Modelle laden</button>
      </div>

      {#if localUrl}
        <label for="ai-ctx">Kontextfenster</label>
        <div class="row prices">
          <select id="ai-ctx" value={draft.contextTokens ?? LOCAL_CONTEXT_TOKENS} onchange={(e) => (draft.contextTokens = Number(e.currentTarget.value))}>
            {#each [8192, 16_384, 32_768, 65_536, 131_072] as n (n)}<option value={n}>{fmt(n)} Token</option>{/each}
          </select>
          {#if speed}<span class="muted small">gemessen: liest {perSecond(speed.promptTps)} Token/s, schreibt {perSecond(speed.outputTps)} Token/s</span>{/if}
        </div>
        <p class="hint muted small">
          Größer = längere Abschnitte mit mehr Zusammenhang, braucht aber mehr Arbeitsspeicher; 32 768 passt für die meisten Modelle.
          {draft.kind === "ollama" ? "Ollama bekommt den Wert mit jeder Anfrage." : "Im Server beim Laden des Modells mindestens so groß einstellen."}
        </p>
      {:else}
        <span class="label">Preise</span>
        <div class="row prices">
          <label>Eingabe <input type="number" min="0" step="0.1" bind:value={draft.priceIn} /> $</label>
          <label>Ausgabe <input type="number" min="0" step="0.1" bind:value={draft.priceOut} /> $</label>
          <span class="muted small">je 1 Mio. Token</span>
        </div>
        <p class="hint muted small">{draft.priceIn + draft.priceOut ? "Für die Kostenschätzung vor jedem Lauf." : "Ohne Preise zeigt die App nur die Tokenmenge."}</p>

        <label for="ai-max">Obergrenze</label>
        <div class="row prices">
          <input id="ai-max" type="number" min="0" step="0.5" bind:value={maxCost} /> <span class="muted small">$ je Lauf – danach startet keine weitere Anfrage</span>
        </div>
      {/if}

      <details class="advanced">
        <summary class="small">Erweitert</summary>
        <div class="grid inner">
          <label for="ai-conc">Gleichzeitige Anfragen</label>
          <input id="ai-conc" type="number" min="1" max="8" bind:value={draft.concurrency} />
          {#if draft.kind !== "anthropic"}
            <label for="ai-struct">Strukturierte Antworten</label>
            <select id="ai-struct" bind:value={draft.structured}>
              <option value="schema">JSON-Schema (empfohlen)</option>
              <option value="json">JSON-Modus</option>
              <option value="prompt">nur Anweisung im Prompt</option>
            </select>
          {/if}
        </div>
      </details>
    </div>

    {#if message}<p class="message small" class:ok={message.ok} class:err={!message.ok} role="status">{message.text}</p>{/if}

    <footer>
      <button onclick={test} disabled={busy === "test" || !draft.baseUrl || !draft.model || blocked || (draft.needsKey && !keyStatus)}>
        {busy === "test" ? (localUrl ? "Teste und messe …" : "Teste …") : "Verbindung testen"}
      </button>
      <span class="grow"></span>
      {#if aiSettings.config}<button class="ghost danger" onclick={disable}>KI ausschalten</button>{/if}
      <button class="primary" onclick={save} disabled={!draft.baseUrl || !draft.model}>Speichern</button>
    </footer>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 70; background: rgb(0 0 0 / 0.4); display: grid; place-items: center; padding: 1rem; }
  .dialog { width: min(40rem, 100%); max-height: 92vh; overflow: auto; padding: 1rem 1.3rem 1.1rem; display: grid; gap: 0.7rem; }
  header { display: flex; justify-content: space-between; align-items: center; }
  h2 { font-size: 1.15rem; }
  .intro { margin: 0; }
  .policy { display: grid; gap: 0.2rem; padding: 0.55rem 0.75rem; border-radius: 8px; background: color-mix(in srgb, var(--ok) 10%, transparent); }
  .policy.cloud { background: color-mix(in srgb, var(--warn) 12%, transparent); }
  .policy label { display: flex; gap: 0.5rem; align-items: baseline; }
  .policy p { margin: 0 0 0 1.5rem; }
  .grid { display: grid; grid-template-columns: 7.5rem 1fr; gap: 0.35rem 0.8rem; align-items: center; }
  .grid > label, .label { color: var(--muted); font-size: 0.88rem; }
  .hint { grid-column: 2; margin: -0.1rem 0 0.35rem; }
  .warn { color: var(--danger); }
  .row { display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; }
  .row input:not([type="number"]) { flex: 1; min-width: 10rem; }
  .prices input { width: 5.5rem; }
  .prices label { display: inline-flex; gap: 0.3rem; align-items: center; font-size: 0.88rem; }
  .ok { color: var(--ok); }
  .advanced { grid-column: 1 / -1; }
  .advanced summary { cursor: pointer; color: var(--muted); }
  .inner { margin-top: 0.4rem; }
  .inner input { width: 5rem; }
  .message { margin: 0; padding: 0.45rem 0.7rem; border-radius: 8px; }
  .message.ok { background: color-mix(in srgb, var(--ok) 12%, transparent); }
  .message.err { background: color-mix(in srgb, var(--danger) 12%, transparent); color: var(--danger); }
  footer { display: flex; gap: 0.4rem; align-items: center; border-top: 1px solid var(--line); padding-top: 0.7rem; }
  .grow { flex: 1; }
</style>
