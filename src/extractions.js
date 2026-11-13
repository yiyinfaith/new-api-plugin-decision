// Extractions: typed values pulled from a text or an image, a task of its own
// beside decisions.
//   Client and upstream: OpenRouter Extractions API (POST /api/alpha/extractions,
//   alpha; https://openrouter.ai/docs/api/api-reference/alphaextractions/submit-an-extractions-request)
//   Upstream: Cloudflare Workers AI Clairic (POST /ai/run/@cf/cloudflare/clairic;
//   https://developers.cloudflare.com/workers-ai/models/clairic), the same
//   fields with images in a top-level array and options instead of provider.
// Answers keep the vendor's shape; both answer in the same one.
//
// Extraction IR: {kind: "extraction", source, model, state, fields, assets,
//   referenceDate, provider, extras, passthrough, input, questions: []}

import { fail, hasOwn, isFiniteNumber, isObject, isStrictBase64 } from "./util.js";

const EX_FIELDS = ["model", "state", "fields", "assets", "reference_date", "provider", "user", "session_id", "trace"];
const COMMON = ["type", "instructions", "unit", "null_threshold"];
// Field keys per type, as the OpenRouter schema lists them.
const EX_TYPES = {
  text: COMMON,
  date: COMMON,
  time: COMMON,
  datetime: COMMON,
  number: COMMON.concat(["integer", "decimals"]),
  duration: COMMON.concat(["integer", "decimals"]),
  list: COMMON.concat(["items", "integer", "decimals"]),
  estimate: ["type", "instructions", "unit", "min", "max", "step", "scale"],
  forecast: ["type", "instructions", "unit", "min", "max", "step", "scale", "horizon", "interval"],
};
const REQUIRED = { list: ["items"], estimate: ["min", "max"], forecast: ["min", "max", "horizon", "interval"] };
const ASSET_FORMATS = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", pdf: "application/pdf" };
const INTERVALS = ["step", "minute", "hour", "day", "week", "month", "quarter", "year"];

function validateField(name, field) {
  const where = 'Field "' + name + '"';
  if (!name.trim()) fail("Field names must contain text");
  if (!isObject(field)) fail(where + " must be an object");
  const keys = EX_TYPES[field.type];
  if (!keys) fail(where + " must have type " + Object.keys(EX_TYPES).join(", "), "unsupported_field_type");
  for (const key of Object.keys(field)) if (keys.indexOf(key) < 0) fail(where + " (" + field.type + ") does not accept " + key, "unknown_field");
  for (const key of REQUIRED[field.type] || []) if (field[key] === undefined) fail(where + " needs " + key);
  if (field.instructions !== undefined && typeof field.instructions !== "string") fail(where + " instructions must be text");
  if (field.unit !== undefined && typeof field.unit !== "string") fail(where + " unit must be text");
  if (field.integer !== undefined && typeof field.integer !== "boolean") fail(where + " integer must be true or false");
  if (field.decimals !== undefined && !(Number.isInteger(field.decimals) && field.decimals >= 0 && field.decimals <= 6)) fail(where + " decimals must be an integer from 0 to 6");
  if (field.null_threshold !== undefined && !(isFiniteNumber(field.null_threshold) && field.null_threshold > 0 && field.null_threshold <= 1)) fail(where + " null_threshold must be above 0 and at most 1");
  if (field.items !== undefined && ["text", "number", "date"].indexOf(field.items) < 0) fail(where + " items must be text, number, or date");
  for (const key of ["min", "max"]) if (field[key] !== undefined && !isFiniteNumber(field[key]) && typeof field[key] !== "string") fail(where + " " + key + " must be a number or a date");
  if (field.step !== undefined && !(isFiniteNumber(field.step) && field.step > 0) && field.step !== "month" && field.step !== "year") fail(where + ' step must be a positive number, "month", or "year"');
  if (field.scale !== undefined && field.scale !== "linear" && field.scale !== "log") fail(where + " scale must be linear or log");
  if (field.horizon !== undefined && !(Number.isInteger(field.horizon) && field.horizon >= 1 && field.horizon <= 64)) fail(where + " horizon must be an integer from 1 to 64");
  if (field.interval !== undefined && INTERVALS.indexOf(field.interval) < 0) fail(where + " interval must be one of " + INTERVALS.join(", "));
}

function exAssets(assets) {
  if (assets === undefined) return {};
  if (!isObject(assets) || Object.keys(assets).length === 0) fail("assets must be a nonempty object");
  const result = {};
  for (const key of Object.keys(assets)) {
    const asset = assets[key];
    const where = 'Asset "' + key + '"';
    if (!key.trim()) fail("Asset references cannot be empty");
    if (!isObject(asset)) fail(where + " must be an object");
    for (const member of Object.keys(asset)) if (["type", "format", "data_base64"].indexOf(member) < 0) fail(where + " does not accept " + member, "unknown_field");
    if (!hasOwn(ASSET_FORMATS, asset.format)) fail(where + " format must be png, jpg, jpeg, webp, or pdf");
    if (asset.type !== undefined && asset.type !== "image" && asset.type !== "document") fail(where + " type must be image or document");
    if (!isStrictBase64(asset.data_base64) || !asset.data_base64) fail(where + " data_base64 must be standard base64 without a data: prefix");
    result[key] = { t: "media", kind: asset.format === "pdf" ? "document" : "image", mime: ASSET_FORMATS[asset.format], data: asset.data_base64 };
  }
  return result;
}

// The assets are read as files alone when the state is empty or is exactly
// the one asset's key; otherwise every asset is referenced in the state or in
// a field's instructions.
function fileOnly(state, keys) {
  return state === "" || (keys.length === 1 && state === keys[0]);
}

export function exDecode(body) {
  if (!isObject(body)) fail("Request body must be a JSON object");
  if (body.questions !== undefined) fail("An extractions request has fields, not questions; send decisions to /api/alpha/decisions", "unknown_field");
  for (const key of Object.keys(body)) if (EX_FIELDS.indexOf(key) < 0) fail("The Extractions API does not accept the request field " + key, "unknown_field");
  if (typeof body.model !== "string" || !body.model.trim()) fail("model is required");
  const state = body.state === undefined ? "" : body.state;
  if (typeof state !== "string") fail("state must be text");
  if (!isObject(body.fields) || Object.keys(body.fields).length === 0) fail("fields must be a nonempty object");
  for (const name of Object.keys(body.fields)) validateField(name, body.fields[name]);
  const assets = exAssets(body.assets);
  const keys = Object.keys(assets);
  if (state === "" && keys.length === 0) fail("state may be empty only when the request has assets");
  if (keys.length && !fileOnly(state, keys)) {
    const text = state + "\n" + Object.keys(body.fields).map((name) => body.fields[name].instructions || "").join("\n");
    for (const key of keys) if (text.indexOf(key) < 0) fail('Asset "' + key + '" is not referenced in the state or in a field\'s instructions');
  }
  if (body.reference_date !== undefined && !(typeof body.reference_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.reference_date))) fail("reference_date must be YYYY-MM-DD");
  if (body.provider !== undefined && body.provider !== null && !isObject(body.provider)) fail("provider must be an object");
  for (const key of ["user", "session_id"]) if (body[key] !== undefined && !(typeof body[key] === "string" && body[key].length <= 256)) fail(key + " must be text of at most 256 characters");
  const extras = { important: {}, ignorable: {} };
  if (isObject(body.provider)) extras.important.provider = body.provider;
  for (const key of ["user", "session_id", "trace"]) if (body[key] !== undefined) extras.ignorable[key] = body[key];
  const input = [{ t: "text", text: state }].concat(keys.map((key) => assets[key]));
  return {
    kind: "extraction",
    source: { family: "extraction", dialect: "openrouter" },
    model: body.model,
    state: state,
    fields: body.fields,
    assets: assets,
    referenceDate: body.reference_date,
    extras: extras,
    passthrough: body,
    input: input,
    questions: [],
  };
}

// ---- upstream encoders ------------------------------------------------------

export function exEncode(ir, dialect, model) {
  if (dialect === "openrouter") {
    const body = {};
    for (const key of Object.keys(ir.passthrough)) body[key] = key === "model" ? model : ir.passthrough[key];
    return { body: body };
  }
  // Cloudflare Workers AI Clairic.
  const body = { model: model };
  const keys = Object.keys(ir.assets);
  body.state = keys.length && fileOnly(ir.state, keys) ? "" : ir.state;
  for (const name of Object.keys(ir.fields)) {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(name)) fail('Field "' + name + '": Clairic field names start with a letter or _ and hold up to 64 letters, digits, _ . -', "invalid_request");
  }
  body.fields = ir.fields;
  if (keys.length) {
    if (keys.length > 4) fail("Clairic reads at most 4 images per request", "limit_exceeded");
    body.images = keys.map(function (key) {
      const asset = ir.assets[key];
      if (asset.kind !== "image") fail('Asset "' + key + '" is a PDF; Clairic reads PNG, JPEG, and WebP images only', "unsupported_modality");
      return { content_type: asset.mime, base64: asset.data };
    });
  }
  if (ir.referenceDate !== undefined) body.reference_date = ir.referenceDate;
  const provider = ir.extras.important.provider;
  if (provider) {
    // Only the Cloudflare options of OpenRouter's provider object apply here.
    for (const key of Object.keys(provider)) if (key !== "options") fail("The request field provider." + key + " has no equivalent on Clairic", "unsupported_field");
    const options = isObject(provider.options) ? provider.options : {};
    for (const slug of Object.keys(options)) if (slug !== "cloudflare") fail("provider.options." + slug + " has no equivalent on Clairic", "unsupported_field");
    if (isObject(options.cloudflare)) {
      for (const key of Object.keys(options.cloudflare)) if (key !== "include_quantiles" && key !== "return_state_text") fail("provider.options.cloudflare." + key + " has no equivalent on Clairic", "unsupported_field");
      body.options = options.cloudflare;
    }
  }
  return { body: body };
}

// ---- upstream reply ---------------------------------------------------------

function exInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

export function exParse(body, ir) {
  if (!isObject(body) || !isObject(body.answers)) fail("The upstream reply has no answers object", "upstream_invalid", 502);
  for (const name of Object.keys(ir.fields)) {
    const answer = body.answers[name];
    if (!isObject(answer) || typeof answer.type !== "string" || !hasOwn(answer, "value")) fail('The answer to field "' + name + '" is missing', "upstream_invalid", 502);
  }
  let usage = null;
  if (isObject(body.usage) && exInteger(body.usage.input_tokens) !== undefined) {
    const input = body.usage.input_tokens;
    const output = exInteger(body.usage.output_tokens) || 0;
    usage = { input: input, cacheRead: 0, cacheWrite: 0, output: output, reasoning: 0, total: input + output };
    if (isFiniteNumber(body.usage.cost) && body.usage.cost >= 0) usage.cost = body.usage.cost;
  }
  return { model: typeof body.model === "string" ? body.model : "", answers: body.answers, usage: usage };
}

// ---- client renderer --------------------------------------------------------

const USAGE_DETAILS = ["state_tokens", "image_tokens", "schema_tokens", "passes"];

export function exRender(ir, result, taskId) {
  const reply = result.reply;
  const out = { id: taskId, model: result.model || ir.model };
  if (typeof reply.provider === "string") out.provider = reply.provider;
  out.answers = result.answers;
  out.truncated = reply.truncated === true;
  if (hasOwn(reply, "state_text")) out.state_text = reply.state_text;
  const usage = { input_tokens: result.usage ? result.usage.input : 0, output_tokens: result.usage ? result.usage.output : 0 };
  // Token details pass through; the relay's cost stays in the gateway.
  if (isObject(reply.usage)) for (const key of USAGE_DETAILS) if (exInteger(reply.usage[key]) !== undefined) usage[key] = reply.usage[key];
  out.usage = usage;
  return out;
}
