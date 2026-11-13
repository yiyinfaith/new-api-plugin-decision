// A strict mock of the decision upstreams, used by the unit tests in process
// and by the end-to-end tests as an HTTP server:
//   node tests/mock-upstream.mjs 49310
// It validates each request against its protocol's documented shape and
// answers deterministically, so a converted request that drifts from the
// protocol fails loudly. Every request is recorded in `received`.
import { createServer } from "node:http";

export const received = [];

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const header = (headers, name) => {
  for (const key of Object.keys(headers || {})) if (key.toLowerCase() === name.toLowerCase()) return headers[key];
  return undefined;
};

class Reject extends Error {
  constructor(status, body) {
    super(JSON.stringify(body));
    this.status = status;
    this.body = body;
  }
}
const reject = (status, body) => {
  throw new Reject(status, body);
};

// Deterministic probabilities over n options: the first option wins.
function spread(n) {
  if (n === 1) return [1];
  const first = 0.6;
  const rest = (1 - first) / (n - 1);
  return Array.from({ length: n }, (_, i) => (i === 0 ? first : Number(rest.toFixed(6))));
}
const tokens = (body) => Math.max(1, Math.ceil(JSON.stringify(body).length / 4));

function special(model) {
  if (model === "fail-401") return { status: 401 };
  if (model === "fail-429") return { status: 429 };
  if (model === "fail-500") return { status: 500 };
  return null;
}

// ---- System One (TypeSafe; strict top-level members) ----------------------
function systemOne(headers, body, dialect) {
  if (!isObj(body)) reject(422, { detail: [{ loc: ["body"], msg: "not an object", type: "type_error" }] });
  const allowed = dialect === "openrouter" ? ["model", "state", "questions", "assets", "provider", "session_id", "trace", "user"] : ["model", "state", "questions", "assets", "images"];
  for (const key of Object.keys(body)) if (!allowed.includes(key)) reject(422, { detail: [{ loc: ["body", key], msg: "Extra inputs are not permitted", type: "extra_forbidden" }] });
  if (typeof body.model !== "string") reject(422, { detail: [{ loc: ["body", "model"], msg: "Field required", type: "missing" }] });
  const sp = special(body.model);
  if (sp) reject(sp.status, dialect === "openrouter" ? { error: { code: sp.status, message: "mock " + sp.status } } : { detail: "mock " + sp.status });
  if (body.state === undefined || body.state === null) reject(422, { detail: [{ loc: ["body", "state"], msg: "Field required", type: "missing" }] });
  if (!isObj(body.questions) || !Object.keys(body.questions).length) reject(422, { detail: [{ loc: ["body", "questions"], msg: "bad", type: "value_error" }] });
  if (body.images !== undefined) {
    if (!Array.isArray(body.images) || body.images.length > 4) reject(422, { detail: "images: at most 4" });
    for (const image of body.images) {
      const ok = typeof image === "string" || (isObj(image) && typeof image.base64 === "string" && (typeof image.mediaType === "string" || typeof image.content_type === "string"));
      if (!ok) reject(422, { detail: "bad image" });
    }
  }
  const images = body.assets !== undefined || Object.values(body.questions).some((q) => q.type === "box");
  if (images && header(headers, "TypeSafe-Danger-Zone-Images") !== "true") reject(400, { detail: "Images require the TypeSafe-Danger-Zone-Images header" });
  if (body.assets !== undefined) {
    for (const [key, asset] of Object.entries(body.assets)) {
      if (asset.part === undefined && (!["png", "jpg", "jpeg"].includes(asset.format) || typeof asset.data_base64 !== "string")) reject(400, { detail: "bad asset " + key });
      if (!JSON.stringify([body.state, body.questions]).includes(key)) reject(400, { detail: "asset " + key + " is not referenced" });
    }
  }
  const answers = {};
  for (const [name, q] of Object.entries(body.questions)) {
    if (q.type === "noul") answers[name] = { type: "noul", noul: 0.8 };
    else if (q.type === "choice") {
      if (!isObj(q.criteria) || !Object.keys(q.criteria).length || Object.keys(q.criteria).length > 255) reject(422, { detail: "choice criteria" });
      const keys = Object.keys(q.criteria);
      const p = spread(keys.length);
      answers[name] = { type: "choice", choice: keys[0], confidence: 0.55, probabilities: Object.fromEntries(keys.map((k, i) => [k, p[i]])) };
    } else if (q.type === "score") {
      if (!Array.isArray(q.criteria) || !q.criteria.length || q.criteria.length > 10) reject(422, { detail: "score criteria" });
      const p = spread(q.criteria.length);
      answers[name] = {
        type: "score",
        score: p.reduce((s, v, i) => s + v * i, 0),
        confidence: 0.5,
        legend: Object.fromEntries(q.criteria.map((c, i) => [String(i), c])),
        probabilities: Object.fromEntries(p.map((v, i) => [String(i), v])),
      };
    } else if (q.type === "box") answers[name] = { type: "box", box: { top: 0.1, bottom: 0.9, left: 0.2, right: 0.8 }, confidence: null };
    else if (q.type === "locate") answers[name] = { type: "locate", spans: [] };
    else if (q.type === "number") answers[name] = { type: "number", number: 25.5, text: "25.5", confidence: 0.99 };
    else reject(422, { detail: "unknown type " + q.type });
  }
  const input = tokens(body);
  const reply = { model: body.model === "jev-latest" ? "jev-1.14.0" : body.model, answers };
  if (body.model !== "missing-usage") {
    reply.usage = { input_tokens: input, output_tokens: 0 };
    if (dialect === "openrouter") Object.assign(reply.usage, { cost: 0.0001, input_tokens_details: { cached_tokens: 3 } });
  }
  if (dialect === "openrouter") return Object.assign({ id: "gen-1", provider: "TypeSafe" }, reply);
  return reply;
}

// ---- OpenAI Decisions --------------------------------------------------------
function openAIContent(value, where) {
  if (typeof value === "string") return;
  if (!Array.isArray(value)) reject(400, { error: { message: where + " must be string or parts", type: "invalid_request_error", param: where, code: null } });
  for (const part of value) {
    if (part.type === "input_text" && typeof part.text === "string") continue;
    if (part.type === "input_json" && (isObj(part.data) || (Array.isArray(part.data) && part.data.every(isObj)))) continue;
    if (part.type === "input_image" && typeof part.image_url === "string" && /^(data:|https?:\/\/)/.test(part.image_url)) continue;
    reject(400, { error: { message: "bad part " + JSON.stringify(part).slice(0, 80), type: "invalid_request_error", param: where, code: null } });
  }
}

function openAI(headers, body) {
  const err = (message, param) => reject(400, { error: { message, type: "invalid_request_error", param: param || null, code: null } });
  if (!isObj(body)) err("body");
  for (const key of Object.keys(body)) if (!["model", "input", "questions", "prompt_cache_key", "prompt_cache_options", "safety_identifier"].includes(key)) err("Unknown parameter: " + key, key);
  const sp = special(body.model);
  if (sp) reject(sp.status, { error: { message: "mock " + sp.status, type: "mock_error", param: null, code: "mock" } });
  if (typeof body.input === "string") {
  } else if (Array.isArray(body.input)) {
    for (const item of body.input) {
      if (!isObj(item) || !["user", "developer", "system", "assistant"].includes(item.role)) err("bad input item", "input");
      openAIContent(item.content, "input.content");
    }
  } else err("input required", "input");
  if (!Array.isArray(body.questions) || body.questions.length < 1 || body.questions.length > 400) err("questions 1-400", "questions");
  const answers = body.questions.map((q, index) => {
    const name = q.name === undefined ? null : q.name;
    if (q.instructions === undefined) err("instructions required", "questions[" + index + "].instructions");
    openAIContent(q.instructions, "questions[" + index + "].instructions");
    if (q.type === "predicate") return { type: "predicate", name, probability: 0.8 };
    if (q.type === "choice") {
      if (!Array.isArray(q.choices) || q.choices.length < 2 || q.choices.length > 255) err("choices 2-255");
      for (const c of q.choices) if (typeof c.value !== "string" && typeof c.value !== "boolean") err("choice value");
      const p = spread(q.choices.length);
      return { type: "choice", name, choice: q.choices[0].value, probabilities: q.choices.map((c, i) => ({ value: c.value, probability: p[i] })), confidence: 0.55 };
    }
    if (q.type === "score") {
      if (!Array.isArray(q.levels) || q.levels.length < 2 || q.levels.length > 10) err("levels 2-10");
      for (const l of q.levels) if (typeof l.label !== "string") err("level label");
      const p = spread(q.levels.length);
      return { type: "score", name, score: p.reduce((s, v, i) => s + v * i, 0), probabilities: q.levels.map((l, i) => ({ value: i, label: l.label, probability: p[i] })), confidence: 0.5 };
    }
    if (q.type === "box") return { type: "box", name, box: { top: 0.1, bottom: 0.9, left: 0.2, right: 0.8 }, confidence: 0.4 };
    if (q.type === "refuse") return { type: "refusal", name };
    err("unknown type " + q.type);
  });
  const input = tokens(body);
  const reply = { model: body.model, answers };
  if (body.model === "bifrost-usage") reply.usage = { prompt_tokens: input, completion_tokens: 0, total_tokens: input };
  else if (body.model !== "missing-usage")
    reply.usage = {
      input_tokens: input,
      input_tokens_details: { cached_tokens: Math.floor(input / 4), cache_write_tokens: Math.floor(input / 8) },
      output_tokens: 0,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: input,
    };
  return reply;
}

// ---- Gemini Decisions --------------------------------------------------------
function gemini(headers, body) {
  const err = (message) => reject(400, { error: { code: 400, message, status: "INVALID_ARGUMENT" } });
  if (!header(headers, "x-goog-api-key")) reject(401, { error: { code: 401, message: "API key missing", status: "UNAUTHENTICATED" } });
  if (!isObj(body)) err("body");
  for (const key of Object.keys(body)) if (!["model", "input", "questions"].includes(key)) err("Unknown name " + key);
  const sp = special(body.model);
  if (sp) reject(sp.status, { error: { code: sp.status, message: "mock " + sp.status, status: sp.status === 429 ? "RESOURCE_EXHAUSTED" : "UNAUTHENTICATED" } });
  const blocks = typeof body.input === "string" ? null : Array.isArray(body.input) ? body.input : [body.input];
  if (blocks) {
    for (const b of blocks) {
      if (b.type === "text" && typeof b.text === "string") continue;
      if (["image", "audio", "video", "document"].includes(b.type) && typeof b.mime_type === "string" && (typeof b.data === "string" || typeof b.uri === "string")) continue;
      err("bad block " + JSON.stringify(b).slice(0, 80));
    }
  }
  if (!isObj(body.questions)) err("questions");
  const answers = {};
  for (const [id, q] of Object.entries(body.questions)) {
    if (typeof q.instructions !== "string" && !Array.isArray(q.instructions) && !isObj(q.instructions)) err("instructions required for " + id);
    if (q.type === "noul") answers[id] = { type: "noul", noul: 0.8, confidence: 0.8 };
    else if (q.type === "choice") {
      if (!isObj(q.criteria) || Object.keys(q.criteria).length < 2) err("choice needs 2+");
      for (const v of Object.values(q.criteria)) if (typeof v !== "string") err("choice description must be string");
      const keys = Object.keys(q.criteria);
      const p = spread(keys.length);
      answers[id] = { type: "choice", choice: keys[0], probabilities: Object.fromEntries(keys.map((k, i) => [k, p[i]])), confidence: 0.6 };
    } else if (q.type === "score") {
      if (!Array.isArray(q.criteria) || q.criteria.length < 2 || q.criteria.some((c) => typeof c !== "string" || !c)) err("score levels");
      const p = spread(q.criteria.length);
      answers[id] = { type: "score", score: p.reduce((s, v, i) => s + v * i, 0), probabilities: Object.fromEntries(p.map((v, i) => [String(i), v])), legend: Object.fromEntries(q.criteria.map((c, i) => [String(i), c])), confidence: 0.6 };
    } else err("unknown type " + q.type);
  }
  const input = tokens(body);
  const reply = { answers };
  if (body.model !== "missing-usage") reply.usage = { total_input_tokens: input, total_cached_tokens: 2, total_output_tokens: 0, total_tokens: input };
  return reply;
}

// ---- Vercel evaluation (AI SDK shape) ---------------------------------------
function vercel(headers, body, sdk) {
  const err = (message) => reject(400, { error: { message, type: "invalid_request_error" } });
  if (!isObj(body)) err("body");
  const allowed = sdk ? ["state", "questions"] : ["model", "state", "questions", "providerOptions"];
  for (const key of Object.keys(body)) if (!allowed.includes(key)) err("unknown field " + key);
  const model = sdk ? header(headers, "ai-model-id") : body.model;
  if (typeof model !== "string") err("model");
  const sp = special(model);
  if (sp) reject(sp.status, { error: { message: "mock " + sp.status, type: "mock_error" } });
  if (!isObj(body.questions)) err("questions");
  const answers = {};
  const confidence = {};
  for (const [id, q] of Object.entries(body.questions)) {
    if (q.type === "boolean") answers[id] = { type: "boolean", probability: 0.8 };
    else if (q.type === "choice") {
      const keys = Object.keys(q.criteria);
      const p = spread(keys.length);
      answers[id] = { type: "choice", choice: keys[0], probabilities: Object.fromEntries(keys.map((k, i) => [k, p[i]])) };
      confidence[id] = 0.55;
    } else if (q.type === "score") {
      const p = spread(q.criteria.length);
      answers[id] = { type: "score", score: p.reduce((s, v, i) => s + v * i, 0), probabilities: Object.fromEntries(p.map((v, i) => [String(i), v])) };
      confidence[id] = 0.5;
    } else if (q.type === "box") answers[id] = { type: "box", top: 0.1, bottom: 0.9, left: 0.2, right: 0.8 };
    else err("unknown type " + q.type);
  }
  const input = tokens(body);
  const reply = { answers, providerMetadata: { typesafe: { confidence } } };
  if (model !== "missing-usage") reply.usage = { inputTokens: input, outputTokens: 0 };
  return reply;
}

// ---- Databricks ai-decide (no model, no usage) ------------------------------
// Under /decision/ it stands in for another New API, whose gateway needs a model.
function databricks(path, headers, body, gateway) {
  const err = (message) => reject(400, { error_code: "INVALID_PARAMETER_VALUE", message });
  const auth = header(headers, "Authorization");
  if (typeof auth !== "string" || !auth.startsWith("Bearer ")) reject(401, { error_code: "UNAUTHENTICATED", message: "Credential was not sent" });
  const fail = /[?&]fail=(\d{3})/.exec(path);
  if (fail) reject(Number(fail[1]), { error_code: Number(fail[1]) === 429 ? "RESOURCE_EXHAUSTED" : "PERMISSION_DENIED", message: "mock " + fail[1] });
  if (!isObj(body)) err("body");
  if (gateway && typeof body.model !== "string") err("model is required");
  for (const key of Object.keys(body)) if (!["state", "questions", "options"].concat(gateway ? ["model"] : []).includes(key)) err("Unknown field " + key);
  if (body.state === undefined || body.state === null || (typeof body.state !== "string" && typeof body.state !== "object")) err("state");
  if (body.options !== undefined && (!isObj(body.options) || Object.keys(body.options).some((k) => k !== "version") || body.options.version !== "1.0")) err("options");
  if (!isObj(body.questions) || !Object.keys(body.questions).length) err("questions");
  const blank = (v) => v === null || v === undefined || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && !v.length) || (isObj(v) && !Object.keys(v).length);
  const answers = {};
  for (const [id, q] of Object.entries(body.questions)) {
    for (const key of Object.keys(q)) if (!["type", "instructions", "criteria"].includes(key)) err("Unknown member " + key);
    if (q.instructions === undefined || q.instructions === null) err("instructions required for " + id);
    if (q.type === "noul") {
      if (q.criteria !== undefined && (!isObj(q.criteria) || Object.keys(q.criteria).some((k) => k !== "true" && k !== "false") || Object.values(q.criteria).some((v) => v === null))) err("noul criteria");
      answers[id] = { type: "noul", probability: 0.8 };
    } else if (q.type === "choice") {
      if (!isObj(q.criteria) || !Object.keys(q.criteria).length || Object.keys(q.criteria).length > 255) err("choice criteria 1-255");
      const keys = Object.keys(q.criteria);
      const p = spread(keys.length);
      answers[id] = { type: "choice", choice: keys[0], probabilities: Object.fromEntries(keys.map((k, i) => [k, p[i]])), confidence: 0.55 };
    } else if (q.type === "score") {
      if (!Array.isArray(q.criteria) || q.criteria.length < 2 || q.criteria.length > 10 || q.criteria.some(blank)) err("score criteria 2-10");
      const p = spread(q.criteria.length);
      answers[id] = { type: "score", score: p.reduce((s, v, i) => s + v * i, 0), probabilities: Object.fromEntries(p.map((v, i) => [String(i), v])), legend: Object.fromEntries(q.criteria.map((c, i) => [String(i), c])), confidence: 0.5 };
    } else err("unknown type " + q.type);
  }
  return { response: { answers }, metadata: { version: "1.0" } };
}

// ---- Parallel Decisions (no model, x-api-key) --------------------------------
function parallel(headers, body) {
  const err = (message) => reject(422, { type: "error", error: { ref_id: "ref_1", message, detail: null } });
  if (!header(headers, "x-api-key")) reject(401, { type: "error", error: { ref_id: "ref_0", message: "missing key", detail: null } });
  if (!isObj(body)) err("body");
  for (const key of Object.keys(body)) if (!["state", "questions", "mode", "advanced_settings"].includes(key)) err("Unknown field " + key);
  if (!isObj(body.questions) || !Object.keys(body.questions).length || Object.keys(body.questions).length > 100) err("questions 1-100");
  const answers = {};
  for (const [name, q] of Object.entries(body.questions)) {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) err("bad name " + name);
    if (typeof q.instructions !== "string") err("instructions must be a string");
    if (q.type === "noul") answers[name] = { type: "noul", noul: 0.8 };
    else if (q.type === "choice") {
      const keys = Object.keys(q.criteria || {});
      if (keys.length < 2 || keys.length > 255) err("choice 2-255");
      const p = spread(keys.length);
      answers[name] = { type: "choice", choice: keys[0], probabilities: Object.fromEntries(keys.map((k, i) => [k, p[i]])), confidence: 0.55 };
    } else if (q.type === "score") {
      if (!Array.isArray(q.criteria) || q.criteria.length < 2 || q.criteria.length > 10 || q.criteria.some((c) => typeof c !== "string")) err("score 2-10 strings");
      const p = spread(q.criteria.length);
      answers[name] = { type: "score", score: p.reduce((s, v, i) => s + v * i, 0), legend: Object.fromEntries(q.criteria.map((c, i) => [String(i), c])), probabilities: Object.fromEntries(p.map((v, i) => [String(i), v])), confidence: 0.5 };
    } else err("unknown type " + q.type);
  }
  return { mode: "fast", answers, usage: { input_tokens: tokens(body), output_tokens: 0 }, citations: [{ url: "https://example.com", title: "Example", excerpts: [] }], decision_id: "decisions_0123456789abcdef0123456789abcdef" };
}

// ---- Extractions (OpenRouter shape; Clairic answers the same way) ----------
const EXTRACTION_ANSWERS = {
  text: { type: "text", value: "INV-7", guess: "INV-7", span: [0, 5], p_null: 0.01, confidence: 0.98 },
  number: { type: "number", value: 41.5, guess: 41.5, p_null: 0.02, confidence: 0.9 },
  date: { type: "date", value: "2026-12-01", guess: "2026-12-01", p_null: 0.05 },
  time: { type: "time", value: "09:30", guess: "09:30", p_null: 0.1 },
  datetime: { type: "datetime", value: "2026-12-01T09:30", guess: "2026-12-01T09:30", p_null: 0.1 },
  duration: { type: "duration", value: 30, guess: 30, unit: "days", p_null: 0.1 },
  list: { type: "list", value: ["a@example.com"], guess: ["a@example.com"], spans: [[10, 23]], confidences: [0.9], p_null: 0.1 },
  estimate: { type: "estimate", value: 30, guess: 30, mean: 31, median: 30, p10: 14, p90: 60, p_below: 0, p_above: 0 },
  forecast: { type: "forecast", value: [1, 2], guess: [1, 2], mean: [1, 2], median: [1, 2], p10: [0, 1], p90: [2, 3], steps: [{ value: 1 }, { value: 2 }] },
};

function extraction(body, cloudflare) {
  const err = (message) => (cloudflare ? reject(400, { success: false, errors: [{ code: 5006, message }], messages: [], result: null }) : reject(400, { error: { code: 400, message } }));
  if (!isObj(body)) err("body");
  const allowed = cloudflare ? ["model", "state", "fields", "images", "reference_date", "options"] : ["model", "state", "fields", "assets", "reference_date", "provider", "user", "session_id", "trace"];
  for (const key of Object.keys(body)) if (!allowed.includes(key)) err("Unknown field " + key);
  const sp = special(body.model);
  if (sp) reject(sp.status, cloudflare ? { success: false, errors: [{ code: 10000, message: "mock " + sp.status }], messages: [], result: null } : { error: { code: sp.status, message: "mock " + sp.status } });
  if (cloudflare && body.model !== "clairic") err("model must be clairic");
  if (!isObj(body.fields) || !Object.keys(body.fields).length) err("fields");
  if (cloudflare && body.images !== undefined && (!Array.isArray(body.images) || body.images.length > 4 || body.images.some((i) => !isObj(i) || !i.content_type || !i.base64))) err("images");
  if (!body.state && !(cloudflare ? body.images : body.assets)) err("state");
  const answers = {};
  for (const [name, field] of Object.entries(body.fields)) {
    if (!EXTRACTION_ANSWERS[field.type]) err("bad type " + field.type);
    answers[name] = EXTRACTION_ANSWERS[field.type];
  }
  const usage = { input_tokens: tokens(body), output_tokens: 0, state_tokens: 3, image_tokens: 0, schema_tokens: 5, passes: 1 };
  if (cloudflare) return { result: { model: "clairic", answers, truncated: false, usage }, success: true, errors: [], messages: [] };
  return { id: "gen-ex-1", model: body.model, provider: "Cloudflare", answers, truncated: false, usage: Object.assign({ cost: 0.00002 }, usage) };
}

export function handle(path, headers, body) {
  const record = { path, headers, body };
  received.push(record);
  try {
    const clean = path.split("?")[0];
    let reply;
    if (clean.endsWith("/chat/completions"))
      reply = {
        id: "chatcmpl-1",
        object: "chat.completion",
        created: 1,
        model: body.model,
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100, prompt_tokens_details: { cached_tokens: 200 } },
      };
    else if (clean.endsWith("/api/alpha/decisions") || clean.endsWith("/api/v1/systemone")) reply = systemOne(headers, body, "openrouter");
    else if (clean.endsWith("/systemone") || clean.endsWith("/scaledown")) reply = systemOne(headers, body, "typesafe");
    else if (clean.endsWith("/v1beta/decisions")) reply = gemini(headers, body);
    else if (clean.endsWith("/v4/ai/evaluation-model")) reply = vercel(headers, body, true);
    else if (clean.endsWith("/v1/evaluate")) reply = vercel(headers, body, false);
    else if (clean.endsWith("/ai-functions/ai-decide")) reply = databricks(path, headers, body, clean.startsWith("/decision/"));
    else if (clean.endsWith("/api/alpha/extractions")) reply = extraction(body, false);
    else if (clean.endsWith("/ai/run/@cf/cloudflare/clairic")) reply = extraction(body, true);
    else if (clean.endsWith("/ai/run")) {
      if (!isObj(body) || body.model !== "openai/decisions" || !isObj(body.input) || Object.keys(body).some((k) => k !== "model" && k !== "input"))
        reject(400, { success: false, errors: [{ code: 5006, message: "expected {model: openai/decisions, input}" }], messages: [], result: null });
      reply = { result: openAI(headers, Object.assign({ model: "gpt-6-luna" }, body.input)), success: true, errors: [], messages: [] };
    } else if (clean.endsWith("/v1/decisions") && header(headers, "x-api-key") && isObj(body) && body.model === undefined) reply = parallel(headers, body);
    else if (clean.endsWith("/decisions")) reply = openAI(headers, body);
    else if (clean.includes("/cloudflare/")) reply = { result: systemOne(headers, body, "typesafe"), success: true, errors: [], messages: [] };
    else reply = { echo: body };
    record.status = 200;
    return { status: 200, body: reply };
  } catch (error) {
    if (error instanceof Reject) {
      record.status = error.status;
      return { status: error.status, body: error.body };
    }
    throw error;
  }
}

// Minimal multipart/form-data reader for the System One SDK upload form.
function parseMultipart(buffer, contentType) {
  const boundary = /boundary=([^;]+)/.exec(contentType)[1].replace(/"/g, "");
  const text = buffer.toString("latin1");
  const parts = {};
  for (const chunk of text.split("--" + boundary)) {
    const index = chunk.indexOf("\r\n\r\n");
    if (index < 0) continue;
    const head = chunk.slice(0, index);
    // Go writes parameters unquoted when they are tokens: name=request.
    const nameMatch = /[;\s]name=(?:"([^"]+)"|([^;\s]+))/.exec(head);
    if (!nameMatch) continue;
    const name = [null, nameMatch[1] || nameMatch[2]];
    const value = chunk.slice(index + 4).replace(/\r\n$/, "");
    const type = /Content-Type:\s*([^\r\n]+)/i.exec(head);
    parts[name[1]] = { value: Buffer.from(value, "latin1"), contentType: type ? type[1] : "", filename: ((/filename=(?:"([^"]*)"|([^;\s]+))/.exec(head) || []).slice(1).find(Boolean)) };
  }
  return parts;
}

export function serve(port) {
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      let body;
      let parts = null;
      const type = req.headers["content-type"] || "";
      if (type.startsWith("multipart/form-data")) {
        parts = parseMultipart(raw, type);
        body = parts.request ? JSON.parse(parts.request.value.toString("utf8")) : null;
      } else {
        try {
          body = JSON.parse(raw.toString("utf8") || "null");
        } catch {
          body = raw.toString("utf8");
        }
      }
      if (req.url === "/__received") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(received.slice(-200)));
        return;
      }
      const result = handle(req.url, req.headers, body);
      if (parts) {
        received[received.length - 1].rawHead = raw.toString("latin1").slice(0, 700);
        received[received.length - 1].parts = Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, { size: v.value.length, contentType: v.contentType, filename: v.filename, head: v.value.toString("utf8").slice(0, 60) }]));
      }
      received[received.length - 1].rawBody = type.startsWith("application/json") ? raw.toString("utf8").slice(0, 4000) : undefined;
      const data = JSON.stringify(result.body);
      res.writeHead(result.status, { "Content-Type": "application/json" });
      res.end(data);
    });
  });
  server.listen(port, "127.0.0.1");
  return server;
}

if (process.argv[1] && process.argv[1].endsWith("mock-upstream.mjs")) {
  serve(Number(process.argv[2] || 49310));
  console.log("mock upstream listening on " + (process.argv[2] || 49310));
}
