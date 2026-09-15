import { describe, expect, it } from "vitest";
import {
  applyBookPatches, applyEdit, castMergeJob, compareSpeakers, configFromPreset, countAsked, estimateJobs, estimateSeconds, extractJson,
  isLocalUrl, LlmClient, LlmError, migrateConfig, presetById, pronunciationJob, reviewQueue, runJobs, speakerChunkChars, speakerJobs,
  updateSpeed, validateBook,
  type Annotation, type Book, type Edit, type HttpRequest, type HttpResponse, type LlmJob, type ProviderConfig, type Transport,
} from "../src/index.js";
import { sampleBook } from "./helpers.js";

const NOW = new Date("2026-09-14T12:00:00Z");
const speech = (book: Book, id: string) => book.annotations.find((a) => a.id === id) as Extract<Annotation, { type: "speech" }>;

function apply(book: Book, edit: Edit) {
  const res = applyEdit(book, edit, NOW);
  expect(() => validateBook(JSON.parse(JSON.stringify(res.book)))).not.toThrow();
  expect(applyBookPatches(res.book, res.inverse)).toEqual(book);
  return res.book;
}

/** Transport-Attrappe: zeichnet Anfragen auf und antwortet der Reihe nach */
function fakeTransport(...responses: (HttpResponse | ((req: HttpRequest) => HttpResponse))[]) {
  const requests: HttpRequest[] = [];
  const transport: Transport = async (req) => {
    requests.push(req);
    const next = responses.length > 1 ? responses.shift()! : responses[0]!;
    return typeof next === "function" ? next(req) : next;
  };
  return { transport, requests };
}

const anthropicReply = (json: unknown, usage = { input_tokens: 1000, output_tokens: 200 }) => ({
  status: 200,
  body: JSON.stringify({ content: [{ type: "text", text: JSON.stringify(json) }], stop_reason: "end_turn", usage }),
});
const openaiReply = (content: string) => ({
  status: 200,
  body: JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
});

const anthropic = (): ProviderConfig => configFromPreset(presetById("anthropic")!);
const local = (): ProviderConfig => ({ ...configFromPreset(presetById("lmstudio")!), model: "qwen3" });
const ollama = (): ProviderConfig => ({ ...configFromPreset(presetById("ollama")!), model: "gemma4:26b" });
const ollamaShow = (contextLength: number, capabilities = ["completion", "thinking"]) => ({
  status: 200, body: JSON.stringify({ model_info: { "general.architecture": "gemma4", "gemma4.context_length": contextLength }, capabilities }),
});
const ollamaReply = (json: unknown, extra: Record<string, unknown> = {}) => ({
  status: 200,
  body: JSON.stringify({
    message: { role: "assistant", content: JSON.stringify(json) }, done: true, done_reason: "stop",
    prompt_eval_count: 800, prompt_eval_duration: 20e9, eval_count: 90, eval_duration: 10e9, load_duration: 5e9, ...extra,
  }),
});
const simpleRequest = { system: "s", user: "u", schema: { type: "object" }, schemaName: "t", maxTokens: 100 };

describe("LlmClient", () => {
  it("baut Anthropic-Anfragen mit strukturierter Antwort und liest Verbrauch", async () => {
    const { transport, requests } = fakeTransport(anthropicReply({ ok: true }, { input_tokens: 12, output_tokens: 3 }));
    const client = new LlmClient(anthropic(), transport);
    const res = await client.complete(simpleRequest);
    expect(res).toEqual({ json: { ok: true }, usage: { input: 12, output: 3 }, timing: { totalMs: expect.any(Number) } });
    const req = requests[0]!;
    expect(req).toMatchObject({ provider: "anthropic", url: "https://api.anthropic.com/v1/messages", method: "POST", auth: "x-api-key" });
    expect(req.headers["anthropic-version"]).toBe("2023-06-01");
    expect(Object.keys(req.headers).some((h) => /key|authorization/i.test(h))).toBe(false);
    const body = JSON.parse(req.body!);
    expect(body).toMatchObject({ model: "claude-opus-5", max_tokens: 100, system: "s", output_config: { format: { type: "json_schema", schema: { type: "object" } } } });
  });

  it("stuft bei Servern ohne JSON-Schema herunter und liest JSON auch aus Codeblöcken", async () => {
    const { transport, requests } = fakeTransport(
      { status: 400, body: JSON.stringify({ error: { message: "response_format json_schema is not supported" } }) },
      openaiReply("Hier:\n```json\n{\"ok\": true}\n```"),
    );
    const client = new LlmClient(local(), transport);
    const res = await client.complete(simpleRequest);
    expect(res.json).toEqual({ ok: true });
    expect(client.structured).toBe("json");
    expect(requests.map((r) => JSON.parse(r.body!).response_format?.type)).toEqual(["json_schema", "json_object"]);
    expect(requests[0]).toMatchObject({ url: "http://localhost:1234/v1/chat/completions", auth: "none" });
  });

  it("erkennt, wenn ein lokaler OpenAI-kompatibler Server den Text abschneidet", async () => {
    const long = { ...simpleRequest, user: "Wort ".repeat(6000) };
    const cut = fakeTransport({
      status: 200,
      body: JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" }, finish_reason: "stop" }], usage: { prompt_tokens: 2051, completion_tokens: 5 } }),
    });
    await expect(new LlmClient(local(), cut.transport).complete(long)).rejects.toMatchObject({ kind: "truncated", message: /2051 von etwa 10001/ });
    // Cloud-Anbieter und kurze Anfragen sind davon nicht betroffen
    await expect(new LlmClient(local(), cut.transport).complete(simpleRequest)).resolves.toMatchObject({ json: { ok: true } });
  });

  it("wiederholt bei Überlastung, bricht bei falschem Schlüssel sofort ab", async () => {
    const busy = fakeTransport({ status: 429, body: "{}", retryAfter: 0 }, anthropicReply({ ok: true }));
    await expect(new LlmClient(anthropic(), busy.transport).complete(simpleRequest)).resolves.toMatchObject({ json: { ok: true } });
    expect(busy.requests).toHaveLength(2);

    const denied = fakeTransport({ status: 401, body: JSON.stringify({ error: { message: "invalid x-api-key" } }) });
    const err = await new LlmClient(anthropic(), denied.transport).complete(simpleRequest).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err).toMatchObject({ kind: "auth", status: 401 });
    expect(denied.requests).toHaveLength(1);
  });

  it("erkennt abgeschnittene Antworten und fehlende Konfiguration", async () => {
    const cut = fakeTransport({ status: 200, body: JSON.stringify({ content: [{ type: "text", text: "{\"a\":" }], stop_reason: "max_tokens", usage: {} }) });
    await expect(new LlmClient(anthropic(), cut.transport).complete(simpleRequest)).rejects.toMatchObject({ kind: "truncated" });
    expect(() => new LlmClient({ ...local(), model: "" }, cut.transport)).toThrow(/Kein Modell/);
    expect(() => extractJson("kein json")).toThrow(LlmError);
  });

  it("listet Modelle beider Formate", async () => {
    const { transport } = fakeTransport({ status: 200, body: JSON.stringify({ data: [{ id: "b" }, { id: "a" }] }) });
    expect(await new LlmClient(local(), transport).listModels()).toEqual(["a", "b"]);
    const tags = fakeTransport({ status: 200, body: JSON.stringify({ models: [{ name: "qwen3.8:latest", model: "qwen3.8:latest" }, { name: "gemma4:26b", model: "gemma4:26b" }] }) });
    expect(await new LlmClient(ollama(), tags.transport).listModels()).toEqual(["gemma4:26b", "qwen3.8:latest"]);
    expect(tags.requests[0]).toMatchObject({ url: "http://localhost:11434/api/tags", method: "GET", auth: "none" });
  });
});

describe("Ollama", () => {
  it("setzt Kontextfenster (begrenzt durchs Modell), Schema und schaltet Nachdenken ab; misst die Zeit", async () => {
    const { transport, requests } = fakeTransport(ollamaShow(16_384), ollamaReply({ ok: true }));
    const client = new LlmClient({ ...ollama(), contextTokens: 32_768 }, transport);
    const res = await client.complete({ ...simpleRequest, maxTokens: 50_000 });
    expect(requests.map((r) => r.url)).toEqual(["http://localhost:11434/api/show", "http://localhost:11434/api/chat"]);
    expect(JSON.parse(requests[0]!.body!)).toEqual({ model: "gemma4:26b" });
    const body = JSON.parse(requests[1]!.body!);
    expect(body).toMatchObject({ model: "gemma4:26b", stream: false, think: false, format: { type: "object" }, options: { num_ctx: 16_384 } });
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(["system", "user"]);
    expect(body.options.num_predict).toBeLessThan(16_384);
    expect(client.contextTokens).toBe(16_384);
    expect(res.json).toEqual({ ok: true });
    expect(res.usage).toEqual({ input: 800, output: 90 });
    expect(res.timing).toMatchObject({ promptMs: 20_000, promptTokens: 800, outputMs: 10_000, outputTokens: 90 });
  });

  it("alte Einstellungen mit …/v1 laufen über die eigene Schnittstelle; Modell ohne Nachdenken bekommt kein think", async () => {
    const old = migrateConfig({ ...ollama(), kind: "openai", baseUrl: "http://localhost:11434/v1/", contextTokens: undefined });
    expect(old).toMatchObject({ kind: "ollama", baseUrl: "http://localhost:11434", contextTokens: 32_768 });
    const { transport, requests } = fakeTransport(ollamaShow(262_144, ["completion"]), ollamaReply({ ok: true }));
    await new LlmClient(old, transport).complete(simpleRequest);
    const body = JSON.parse(requests[1]!.body!);
    expect(body.think).toBeUndefined();
    expect(body.options.num_ctx).toBe(32_768);
  });

  it("lehnt zu lange Abschnitte vor dem Senden ab und meldet abgeschnittene Antworten", async () => {
    const tooLong = fakeTransport(ollamaShow(8192), ollamaReply({ ok: true }));
    const err = await new LlmClient(ollama(), tooLong.transport).complete({ ...simpleRequest, user: "x".repeat(30_000) }).catch((e) => e);
    expect(err).toMatchObject({ kind: "config", message: /Kontextfenster/ });
    expect(tooLong.requests).toHaveLength(1);

    const cut = fakeTransport(ollamaShow(8192), ollamaReply({ ok: true }, { done_reason: "length" }));
    await expect(new LlmClient(ollama(), cut.transport).complete(simpleRequest)).rejects.toMatchObject({ kind: "truncated" });
  });

  it("fehlendes Modell, abgelehntes think, nicht laufender Server", async () => {
    const missing = fakeTransport({ status: 404, body: JSON.stringify({ error: "model 'gemma9' not found" }) });
    await expect(new LlmClient(ollama(), missing.transport).complete(simpleRequest)).rejects.toMatchObject({ kind: "config", message: /ollama pull gemma4:26b/ });

    const noThink = fakeTransport(
      ollamaShow(8192),
      { status: 400, body: JSON.stringify({ error: "\"gemma4:26b\" does not support thinking" }) },
      ollamaReply({ ok: true }),
    );
    await new LlmClient(ollama(), noThink.transport).complete(simpleRequest);
    expect(noThink.requests.map((r) => JSON.parse(r.body!).think)).toEqual([undefined, false, undefined]);

    const down: Transport = async () => {
      throw new Error("connection refused");
    };
    await expect(new LlmClient(ollama(), down).complete(simpleRequest)).rejects.toMatchObject({ kind: "network", message: /läuft Ollama\?/ });
  });

  it("Probeanfrage lokal mit Text, damit die Geschwindigkeit messbar ist", async () => {
    const { transport, requests } = fakeTransport(ollamaShow(8192), ollamaReply({ ok: true, woerter: ["Am", "Morgen"] }));
    const res = await new LlmClient(ollama(), transport).test();
    expect(JSON.parse(requests[1]!.body!).messages[1].content.length).toBeGreaterThan(1000);
    const speed = updateSpeed(null, res.timing)!;
    expect(speed).toMatchObject({ promptTps: 40, outputTps: 9 });
  });
});

describe("lokal oder nicht", () => {
  it("erkennt lokale Adressen wie der Rust-Teil", () => {
    for (const url of [
      "http://localhost:11434", "http://127.0.0.1:1234/v1", "http://[::1]:8080", "http://192.168.1.20:11434", "http://10.0.0.5",
      "http://172.20.1.1", "http://169.254.3.4", "http://gpu-box:11434", "http://nas.local:11434", "https://ki.home.arpa",
      "http://server.lan", "http://[fd12:3456::1]:11434", "http://[fe80::1]",
    ]) expect(isLocalUrl(url), url).toBe(true);
    for (const url of [
      "https://api.anthropic.com/v1", "http://172.32.0.1", "http://8.8.8.8", "https://example.com", "http://[2001:db8::1]", "kein url",
      "https://localhost.example.com",
    ]) expect(isLocalUrl(url), url).toBe(false);
  });
});

describe("Zeitschätzung", () => {
  it("rechnet Messungen gewichtet ein und schätzt die Dauer", async () => {
    const first = updateSpeed(null, { totalMs: 1, promptMs: 10_000, promptTokens: 500, outputMs: 10_000, outputTokens: 100 })!;
    expect(first).toEqual({ promptTps: 50, outputTps: 10, samples: 600 });
    // Ein langer Abschnitt zählt mehr als die kurze Probe
    const second = updateSpeed(first, { totalMs: 1, promptMs: 600_000, promptTokens: 18_000, outputMs: 300_000, outputTokens: 1800 })!;
    expect(second.promptTps).toBeGreaterThan(30);
    expect(second.promptTps).toBeLessThan(32);
    expect(updateSpeed(second, { totalMs: 500 })).toBe(second);

    const { book } = await sampleBook();
    const jobs = speakerJobs(book);
    const est = estimateJobs(jobs, { priceIn: 0, priceOut: 0 });
    expect(estimateSeconds(jobs, { promptTps: 10, outputTps: 2, samples: 1 })).toBeCloseTo(est.input / 10 + est.output / 2);
  });
});

describe("Sprecherzuordnung", () => {
  it("fragt nur unsichere Redeteile, mit sicheren als Orientierung", async () => {
    const { book } = await sampleBook();
    const jobs = speakerJobs(book);
    expect(jobs.map((j) => j.label)).toEqual(["Kapitel 1"]);
    const user = jobs[0]!.request.user;
    expect(user).toContain("⟦Anna⟧»Kommst du mit?«⟦/⟧, fragte Anna. ⟦R1⟧»Es wird bald dunkel.«⟦/R1⟧");
    expect(user).toContain("Zu bestimmen: R1, R2, R3 (3 Passagen)");
    expect(user).toContain("- anna: Anna");
    expect(jobs[0]!.request.schema).toMatchObject({ additionalProperties: false, properties: { items: { items: { additionalProperties: false } } } });
    expect(speakerJobs(book, { includeSure: true })).toHaveLength(2);
    expect(estimateJobs(jobs, { priceIn: 5, priceOut: 25 }).costUsd).toBeGreaterThan(0);
  });

  it("wertet Antworten aus: IDs, Namen statt IDs, neue Figuren, Prozentangaben", async () => {
    const { book } = await sampleBook();
    const job = speakerJobs(book)[0]!;
    const result = job.parse({
      items: [
        { id: "R1", speaker: "anna", newFigure: "", notSpeech: false, confidence: 0.9, note: "gleicher Absatz" },
        { id: "R2", speaker: "Jonas", newFigure: "", notSpeech: false, confidence: 85, note: "" },
        { id: "R3", speaker: "", newFigure: "Marie", notSpeech: false, confidence: 0.7, note: "" },
        { id: "R9", speaker: "anna", newFigure: "", notSpeech: false, confidence: 1, note: "" },
        { id: "R1", speaker: "paul", newFigure: "", notSpeech: false, confidence: 1, note: "doppelt" },
      ],
    });
    expect(result.items).toEqual([
      { id: "a000002", speaker: "anna", notSpeech: false, confidence: 0.9, note: "gleicher Absatz" },
      { id: "a000004", speaker: "jonas", notSpeech: false, confidence: 0.85 },
      { id: "a000005", speaker: null, newFigure: "Marie", notSpeech: false, confidence: 0.7 },
    ]);
    expect(result.missing).toBe(0);
  });

  it("verbindet KI und Regeln: einig, KI übernimmt, Regel bleibt zur Prüfung, keine Rede, Nutzer unantastbar", async () => {
    let { book } = await sampleBook();
    book = apply(book, { type: "setSpeaker", ids: ["a000003"], speaker: "jonas" });
    book = apply(book, {
      type: "applySpeakerSuggestions", model: "test",
      items: [
        { id: "a000002", speaker: "anna", confidence: 0.9 },
        { id: "a000004", speaker: "jonas", confidence: 0.85 },
        { id: "a000005", speaker: null, newFigure: "Marie", confidence: 0.7 },
        { id: "a000001", speaker: "jonas", confidence: 0.9, note: "Pronomen" },
        { id: "a000007", speaker: null, notSpeech: true, confidence: 0.8 },
        { id: "a000003", speaker: "paul", confidence: 1 },
        { id: "a000006", speaker: "anna", confidence: 0.55, note: "geraten" },
      ],
    });
    expect(speech(book, "a000002")).toMatchObject({ speaker: "anna", origin: "llm", confidence: 0.97 });
    expect(speech(book, "a000004")).toMatchObject({ speaker: "jonas", origin: "llm", via: "llm", confidence: 0.77, suggestion: { speaker: "anna", source: "rule" } });
    expect(book.cast.find((c) => c.name === "Marie")).toMatchObject({ id: "marie", origin: "llm" });
    expect(speech(book, "a000005")).toMatchObject({ speaker: "marie", confidence: 0.45, suggestion: { speaker: "jonas", source: "rule" } });
    expect(speech(book, "a000001")).toMatchObject({ speaker: "anna", origin: "rule", confidence: 0.45, suggestion: { speaker: "jonas", source: "llm", note: "Pronomen" } });
    expect(speech(book, "a000007")).toMatchObject({ speaker: "anna", confidence: 0.45, suggestion: { notSpeech: true, speaker: null } });
    expect(speech(book, "a000003")).toMatchObject({ speaker: "jonas", origin: "user", confidence: 1 });
    expect(speech(book, "a000003").suggestion).toBeUndefined();
    // Unsichere Gegenmeinung: Vorschlag hängt dran, aber keine Prüfung
    expect(speech(book, "a000006")).toMatchObject({ speaker: "paul", confidence: 0.95, suggestion: { speaker: "anna", confidence: 0.55 } });
    expect(reviewQueue(book).map((a) => a.id)).toEqual(["a000001", "a000005", "a000007"]);
    expect(book.chapterColors.ch002).toMatchObject({ marie: expect.any(Number) });

    // Entscheidung des Menschen räumt den Vorschlag weg
    book = apply(book, { type: "setSpeaker", ids: ["a000001"], speaker: "jonas" });
    expect(speech(book, "a000001").suggestion).toBeUndefined();
  });

  it("ein neuer Lauf setzt fort: schon Eingeschätztes wird nur mit recheck erneut gefragt", async () => {
    let { book } = await sampleBook();
    expect(countAsked(book)).toBe(3);
    book = apply(book, {
      type: "applySpeakerSuggestions", model: "test",
      // a000002: einig → llm; a000004: unsichere Gegenmeinung → Vorschlag bleibt dran
      items: [{ id: "a000002", speaker: "anna", confidence: 0.9 }, { id: "a000004", speaker: "paul", confidence: 0.4 }],
    });
    expect(countAsked(book)).toBe(1);
    expect(speakerJobs(book)[0]!.request.user).toContain("Zu bestimmen: R1 (1 Passagen)");
    // a000002 ist nach der Bestätigung sicher und fällt auch mit recheck heraus
    expect(countAsked(book, { recheck: true })).toBe(2);
  });

  it("Abschnittsgröße richtet sich nach dem Kontextfenster", async () => {
    const { book } = await sampleBook();
    const small = speakerChunkChars(book, 8192);
    const standard = speakerChunkChars(book, 32_768);
    expect(small).toBeGreaterThanOrEqual(6000);
    expect(standard).toBeGreaterThan(40_000);
    expect(standard).toBeLessThanOrEqual(60_000);
    expect(speakerChunkChars(book, 262_144)).toBe(60_000);
  });
});

describe("Figuren und Aussprache", () => {
  it("prüft Zusammenführungsvorschläge und löst Ketten auf", async () => {
    const { book } = await sampleBook();
    const job = castMergeJob(book)!;
    expect(job.request.user).toContain("- anna: Anna (");
    expect(job.parse({
      merges: [
        { from: "paul", into: "jonas", confidence: 0.9, reason: "Spitzname" },
        { from: "jonas", into: "anna", confidence: 0.8, reason: "" },
        { from: "niemand", into: "anna", confidence: 1, reason: "" },
        { from: "anna", into: "anna", confidence: 1, reason: "" },
        { from: "paul", into: "anna", confidence: 1, reason: "doppelt" },
      ],
    })).toEqual([
      { from: "paul", into: "anna", confidence: 0.9, reason: "Spitzname" },
      { from: "jonas", into: "anna", confidence: 0.8, reason: "" },
    ]);
  });

  it("trägt Aussprachevorschläge ein, ohne Eigenes zu überschreiben", async () => {
    let { book } = await sampleBook();
    book = apply(book, { type: "updatePronunciation", term: "Anna", hint: "AN-na" });
    const job = pronunciationJob(book)!;
    expect(job.request.user).not.toContain("- Anna ");
    expect(job.request.user).toContain("- Jonas (");
    const items = job.parse({ items: [{ term: "Jonas", hint: "JO-nas", ipa: "/ˈjoːnas/" }, { term: "Anna", hint: "x", ipa: "" }, { term: "Paul", hint: "", ipa: "" }] });
    expect(items).toEqual([{ term: "Jonas", hint: "JO-nas", ipa: "ˈjoːnas" }]);
    book = apply(book, { type: "applyPronunciationSuggestions", model: "test", items: [...items, { term: "Anna", hint: "ÄN-na" }] });
    expect(book.pronunciations.find((p) => p.term === "Jonas")).toMatchObject({ hint: "JO-nas", ipa: "ˈjoːnas", origin: "llm", verified: false });
    expect(book.pronunciations.find((p) => p.term === "Anna")).toMatchObject({ hint: "AN-na", origin: "user" });
  });
});

describe("runJobs", () => {
  const job = (key: string, output = 100): LlmJob<string> => ({
    key, label: key, request: { ...simpleRequest, user: "x".repeat(3000) }, expectedOutput: output, parse: (j) => (j as { v: string }).v,
  });

  it("arbeitet parallel und meldet Ergebnisse einzeln", async () => {
    let active = 0;
    let peak = 0;
    const transport: Transport = async (req) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return anthropicReply({ v: JSON.parse(req.body!).messages[0].content.length });
    };
    const client = new LlmClient({ ...anthropic(), concurrency: 2 }, transport);
    const seen: string[] = [];
    const summary = await runJobs(client, [job("a"), job("b"), job("c"), job("d")], { onResult: (j) => void seen.push(j.key) });
    expect(peak).toBe(2);
    expect(seen.sort()).toEqual(["a", "b", "c", "d"]);
    expect(summary).toMatchObject({ done: 4, failed: 0, skipped: 0, stopped: null, usage: { input: 4000, output: 800 } });
    expect(summary.costUsd).toBeCloseTo((4000 * 5 + 800 * 25) / 1e6);
  });

  it("stoppt an der Kostengrenze, bei falschem Schlüssel und bei Abbruch", async () => {
    const ok = fakeTransport(anthropicReply({ v: "x" }));
    const cost = await runJobs(new LlmClient({ ...anthropic(), concurrency: 1 }, ok.transport), [job("a"), job("b")], { maxCostUsd: 0.001 });
    expect(cost).toMatchObject({ done: 0, stopped: "cost", skipped: 1 });

    const denied = fakeTransport({ status: 401, body: "{}" });
    const auth = await runJobs(new LlmClient({ ...anthropic(), concurrency: 1 }, denied.transport), [job("a"), job("b"), job("c")]);
    expect(auth).toMatchObject({ failed: 1, stopped: "auth", skipped: 2 });

    const controller = new AbortController();
    controller.abort();
    const aborted = await runJobs(new LlmClient(anthropic(), ok.transport), [job("a")], { signal: controller.signal });
    expect(aborted.stopped).toBe("aborted");
  });
});

describe("compareSpeakers", () => {
  it("misst Treffer und stille Fehler gegen ein geprüftes Buch", async () => {
    const { book: rules } = await sampleBook();
    let reference = apply(rules, { type: "setSpeaker", ids: ["a000004"], speaker: "jonas" });
    reference = apply(reference, { type: "setSpeaker", ids: ["a000005"], speaker: "anna" });
    reference = apply(reference, { type: "confirmSpeech", ids: ["a000001", "a000006"] });

    expect(compareSpeakers(reference, rules)).toEqual({ reference: 4, found: 4, correct: 2, wrong: 2, unattributed: 0, queued: 2, silentWrong: 0 });

    // KI liegt bei a000004 richtig (übernimmt, nicht mehr in der Prüfung) und bei a000005 falsch und sicher
    const ai = apply(rules, {
      type: "applySpeakerSuggestions", model: "test",
      items: [{ id: "a000004", speaker: "jonas", confidence: 0.9 }, { id: "a000005", speaker: "paul", confidence: 0.95 }],
    });
    expect(compareSpeakers(reference, ai)).toEqual({ reference: 4, found: 4, correct: 3, wrong: 1, unattributed: 0, queued: 0, silentWrong: 1 });
  });
});
