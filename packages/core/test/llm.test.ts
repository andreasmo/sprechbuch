import { describe, expect, it } from "vitest";
import {
  applyBookPatches, applyEdit, castMergeJob, compareSpeakers, configFromPreset, estimateJobs, extractJson, LlmClient, LlmError,
  presetById, pronunciationJob, reviewQueue, runJobs, speakerJobs, validateBook,
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
const local = (): ProviderConfig => ({ ...configFromPreset(presetById("ollama")!), model: "qwen3" });
const simpleRequest = { system: "s", user: "u", schema: { type: "object" }, schemaName: "t", maxTokens: 100 };

describe("LlmClient", () => {
  it("baut Anthropic-Anfragen mit strukturierter Antwort und liest Verbrauch", async () => {
    const { transport, requests } = fakeTransport(anthropicReply({ ok: true }, { input_tokens: 12, output_tokens: 3 }));
    const client = new LlmClient(anthropic(), transport);
    const res = await client.complete(simpleRequest);
    expect(res).toEqual({ json: { ok: true }, usage: { input: 12, output: 3 } });
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
    expect(requests[0]).toMatchObject({ url: "http://localhost:11434/v1/chat/completions", auth: "none" });
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
    const summary = await runJobs(client, [job("a"), job("b"), job("c"), job("d")], { onResult: (j) => seen.push(j.key) });
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
