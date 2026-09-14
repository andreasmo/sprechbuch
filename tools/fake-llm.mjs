#!/usr/bin/env node
/**
 * KI-Attrappe für Entwicklung und Tests – ohne Kosten, ohne Schlüssel beim echten Anbieter.
 *
 * Spricht beide Protokolle, die Sprechbuch nutzt:
 *   POST /v1/messages           Anthropic Messages API (output_config.format)
 *   POST /v1/chat/completions   OpenAI-kompatibel (response_format)
 *   GET  /v1/models
 *
 * Antworten sind deterministisch: Sprecher über Inquit-Formeln im markierten Text, sonst die erste
 * Figur mit geringer Sicherheit; Figuren-Zusammenführung für Namen, die in anderen enthalten sind;
 * Aussprache als Silben in Großbuchstaben.
 *
 *   node tools/fake-llm.mjs [--port 8787] [--key geheim] [--log anfragen.jsonl] [--delay 0]
 *
 * Mit --key verlangt die Attrappe genau diesen Schlüssel (x-api-key bzw. Authorization: Bearer).
 * Das Protokoll enthält nie den Schlüssel, nur ob er stimmte.
 */
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { port: { type: "string", default: "8787" }, key: { type: "string" }, log: { type: "string" }, delay: { type: "string", default: "0" } },
});
const PORT = Number(values.port);
const KEY = values.key;
const DELAY = Number(values.delay);

const INQUIT = /^[,.!?]?\s*(?:sagte|fragte|rief|antwortete|erwiderte|flüsterte|meinte|begrüßte|bat|entgegnete)\s+(?:der\s+|die\s+)?([A-ZÄÖÜ][\p{L}'’-]+)/u;

function castFrom(user) {
  const list = [];
  const block = user.split("Figurenliste (ID: Name):")[1]?.split("\n\n")[0] ?? "";
  for (const line of block.split("\n")) {
    const m = /^- ([^:]+): ([^(]+?)(?: \((.*)\))?$/.exec(line.trim());
    if (m) list.push({ id: m[1], name: m[2].trim(), aliases: /auch: ([^;]+)/.exec(m[3] ?? "")?.[1]?.split(", ") ?? [] });
  }
  return list;
}

function speakers(user) {
  const cast = castFrom(user);
  const ids = /Zu bestimmen: ([^(]+)\(/.exec(user)?.[1].split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  const items = ids.map((id) => {
    const after = user.split(`⟦/${id}⟧`)[1] ?? "";
    const name = INQUIT.exec(after)?.[1];
    const hit = name && cast.find((c) => c.name === name || c.aliases.includes(name));
    if (hit) return { id, speaker: hit.id, newFigure: "", notSpeech: false, confidence: 0.92, note: `Inquit ${name}` };
    if (name) return { id, speaker: "", newFigure: name, notSpeech: false, confidence: 0.8, note: `Inquit ${name}` };
    return { id, speaker: cast[0]?.id ?? "", newFigure: "", notSpeech: false, confidence: 0.55, note: "geraten" };
  });
  return { items };
}

function merges(user) {
  const figs = [...user.matchAll(/^- ([^:]+): ([^(\n]+?) \(/gmu)].map((m) => ({ id: m[1], name: m[2].trim() }));
  const out = [];
  for (const a of figs) {
    const b = figs.find((x) => x !== a && x.name.length > a.name.length && x.name.split(/\s+/).includes(a.name));
    if (b) out.push({ from: b.id, into: a.id, confidence: 0.9, reason: `„${b.name}“ enthält „${a.name}“` });
  }
  return { merges: out };
}

function pronunciation(user) {
  const terms = [...user.matchAll(/^- (.+?) \(\d+×\):/gmu)].map((m) => m[1]);
  return { items: terms.map((term) => ({ term, hint: term.toUpperCase().split("").join("-").slice(0, 30), ipa: "" })) };
}

function answer(schema, user) {
  const props = schema?.properties ?? {};
  if (props.ok) return { ok: true };
  if (props.merges) return merges(user);
  if (props.items?.items?.properties?.term) return pronunciation(user);
  return speakers(user);
}

// CORS, damit auch die Web-Version (Vite-Server) die Attrappe erreicht
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, POST, OPTIONS" };

const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json", ...CORS });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", async () => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      return res.end();
    }
    const auth = req.headers["x-api-key"] ?? req.headers.authorization?.replace(/^Bearer\s+/i, "");
    const authOk = !KEY || auth === KEY;
    const body = raw ? JSON.parse(raw) : {};
    if (values.log) {
      appendFileSync(values.log, `${JSON.stringify({ at: new Date().toISOString(), method: req.method, url: req.url, authOk, model: body.model, keyHeader: req.headers["x-api-key"] ? "x-api-key" : req.headers.authorization ? "bearer" : "none" })}\n`);
    }
    if (DELAY) await new Promise((r) => setTimeout(r, DELAY));
    if (!authOk) return send(res, 401, { error: { type: "authentication_error", message: "invalid api key" } });

    if (req.method === "GET" && req.url?.endsWith("/models")) {
      return send(res, 200, { data: [{ id: "fake-klein" }, { id: "fake-gross" }] });
    }
    if (req.method === "POST" && req.url?.endsWith("/messages")) {
      const user = body.messages?.[0]?.content ?? "";
      const json = answer(body.output_config?.format?.schema, user);
      return send(res, 200, {
        content: [{ type: "text", text: JSON.stringify(json) }],
        stop_reason: "end_turn",
        usage: { input_tokens: Math.ceil((body.system.length + user.length) / 3), output_tokens: Math.ceil(JSON.stringify(json).length / 3) },
      });
    }
    if (req.method === "POST" && req.url?.endsWith("/chat/completions")) {
      const user = body.messages?.find((m) => m.role === "user")?.content ?? "";
      const json = answer(body.response_format?.json_schema?.schema ?? {}, user);
      return send(res, 200, {
        choices: [{ message: { role: "assistant", content: JSON.stringify(json) }, finish_reason: "stop" }],
        usage: { prompt_tokens: Math.ceil(raw.length / 3), completion_tokens: Math.ceil(JSON.stringify(json).length / 3) },
      });
    }
    send(res, 404, { error: { message: `unbekannt: ${req.method} ${req.url}` } });
  });
}).listen(PORT, "127.0.0.1", () => console.log(`KI-Attrappe auf http://127.0.0.1:${PORT}/v1${KEY ? " (Schlüssel verlangt)" : ""}`));
