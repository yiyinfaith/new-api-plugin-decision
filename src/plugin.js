// Entry module: manifest, native routes and the task driver hooks.
// Request:  client body -> client decoder -> Decision IR -> upstream encoder -> upstream
// Response: upstream reply -> upstream parser -> answers/usage IR -> client renderer

import { DEFAULT_EXAMPLES, DEFAULT_SCHEMA, SPECIAL_BILLING, billingProfile, requestFacts, reservationFacts, usageFacts, usageFromTaskData } from "./billing.js";
import { CHANNEL_CONFIG, resolveChannel } from "./channel.js";
import { MODELS } from "./models.js";
import { toDecisionError } from "./ir.js";
import { CLIENTS, CLIENT_ROUTES, UPSTREAMS, clientProtocol, encodeUpstream, parseUpstream, passthroughReply } from "./protocols.js";
import { fail, headerValue, isObject } from "./util.js";

const VERSION = "1.0.2";

const LONG_CONTEXT_HEADER = "TypeSafe-Danger-Zone-Long-Context";
const IMAGES_HEADER = "TypeSafe-Danger-Zone-Images";

const DECODERS = {
  systemone: "decodeSystemOne",
  openrouter: "decodeOpenRouter",
  scaledown: "decodeScaleDown",
  decisions: "decodeDecisions",
  openai: "decodeOpenAI",
  gemini: "decodeGemini",
  vercel: "decodeEvaluate",
  databricks: "decodeDatabricks",
};

export const meta = {
  apiVersion: 1,
  key: "decision",
  name: { en: "Decision", zh: "Decision 决策模型" },
  version: VERSION,
  icon: "text:DE",
  author: { name: "yiyinfaith", url: "https://github.com/yiyinfaith" },
  website: "https://github.com/yiyinfaith/new-api-plugin-decision",
  description: {
    en: "Universal decision model gateway with cross-protocol conversion, flexible model routing, custom upstream protocols, and usage-based billing",
    zh: "NewAPI 通用决策模型插件，支持多种决策协议双向转换、任意模型接入、自定义上游协议及路径、智能路由与灵活计费",
  },
  baseUrl: "https://api.typesafe.ai",
  auth: "api_key",
  models: MODELS,
  upstreams: ["vendor", "new_api"],
  // System One reads state objects as written, so member order changes answers.
  requiredCapabilities: ["json-order@1"],
  fetchMode: "per_task",
  routes: CLIENT_ROUTES.map((route) => ({ method: "POST", path: route.path, type: "submit", decode: DECODERS[route.protocol], render: "renderDecision", retainResult: false })),
  channelConfig: CHANNEL_CONFIG,
  keyHint: { en: "The upstream API key", zh: "上游 API Key" },
  usageSchema: DEFAULT_SCHEMA,
  usageExamples: DEFAULT_EXAMPLES,
  usageProfiles: SPECIAL_BILLING.map((profile) => ({ models: profile.models.filter((model) => MODELS.indexOf(model) >= 0), schema: profile.schema, examples: profile.examples })),
};

// Errors carry their status and code to the error presenter in the message,
// since hooks can only throw Error.
const ERROR_TAG = /\[decision:(\d{3}):([a-z_]+)\]\s?/;

function hookError(error) {
  const decision = toDecisionError(error);
  return new Error("[decision:" + decision.status + ":" + decision.code + "] " + decision.message);
}

function guarded(fn) {
  return function () {
    try {
      return fn.apply(null, arguments);
    } catch (error) {
      throw hookError(error);
    }
  };
}

function run(fn) {
  return guarded(fn)();
}

// The client body: JSON, or the System One SDK's multipart form with the JSON
// in a part named request and each image in its own file part.
function clientBody(body) {
  if (body && body.kind === "json") return { value: body.value, files: [] };
  if (body && body.kind === "multipart") {
    const fields = body.fields && body.fields.request;
    if (!fields || fields.length !== 1) fail("A multipart request needs one request field with the JSON request");
    let value;
    try {
      value = JSON.parse(fields[0]);
    } catch (parseError) {
      fail("The request field must hold the JSON request");
    }
    return { value: value, files: body.files || [] };
  }
  fail("JSON or multipart body required", "unsupported_media_type", 415);
}

function decodeAs(hint) {
  return guarded(function (ctx) {
    const body = clientBody(ctx.body);
    const protocol = hint === "decisions" ? clientProtocol("/v1/decisions", body.value) : hint;
    if (body.files.length && CLIENTS[protocol].family !== "systemone") fail("Only System One requests may upload files as multipart parts");
    const ir = CLIENTS[protocol].decode(body.value, body.files);
    return { kind: "submit", model: ir.model, action: protocol, requestBody: { protocol: protocol, body: body.value } };
  });
}

function longContext(ctx) {
  const value = headerValue(ctx.requestHeaders, LONG_CONTEXT_HEADER);
  return typeof value === "string" && value.trim().toLowerCase() === "true";
}

// Decodes the normalized request again and resolves the channel; driver hooks
// are called several times and must not keep state between calls.
function prepare(ctx) {
  const request = ctx.requestBody;
  if (!isObject(request) || !CLIENTS[request.protocol]) fail("The task request is not a Decision request", "invalid_request", 500);
  const ir = CLIENTS[request.protocol].decode(request.body, ctx.files || []);
  const route = resolveChannel(ctx);
  if (route.maxQuestions > 0 && ir.questions.length > route.maxQuestions)
    fail(
      "This channel accepts at most " + route.maxQuestions + " questions per request and the request has " + ir.questions.length + "; split it into smaller requests",
      "limit_exceeded",
    );
  return { ir: ir, route: route, protocol: request.protocol };
}

export function buildSubmitRequest(ctx) {
  return run(() => submitRequest(ctx));
}

function submitRequest(ctx) {
  const prepared = prepare(ctx);
  const ir = prepared.ir;
  const route = prepared.route;
  const encoded = encodeUpstream(route.protocol, ir, route.model, () => utils.uuid(), { fillInstructions: route.fillInstructions, keepModel: route.keepModel });
  const headers = { Accept: "application/json" };
  for (const name of Object.keys(route.headers)) headers[name] = route.headers[name];
  if (route.upstream.family === "systemone") {
    if (encoded.images) headers[IMAGES_HEADER] = "true";
    if (longContext(ctx)) headers[LONG_CONTEXT_HEADER] = "true";
  }
  if (route.protocol === "vercel_sdk") {
    headers["ai-evaluation-model-specification-version"] = "4";
    headers["ai-gateway-protocol-version"] = "0.0.1";
    headers["ai-gateway-auth-method"] = "api-key";
    headers["ai-model-id"] = route.model;
  }
  const request = { url: route.url, method: "POST", headers: headers };
  // System One with uploaded images: the JSON goes first in a part named
  // request, then each file, as the TypeSafe SDKs send it.
  const passthroughFiles = route.upstream.family === "systemone" && ir.source.family === "systemone" && ir.passthrough ? ctx.files || [] : [];
  const parts = encoded.multipartFiles || (passthroughFiles.length ? passthroughFiles.map((file) => ({ name: file.field, fileRef: file.ref, filename: file.filename })) : null);
  if (parts) {
    request.bodyType = "multipart";
    request.parts = [{ name: "request", value: JSON.stringify(encoded.body) }].concat(parts);
    return request;
  }
  headers["Content-Type"] = "application/json";
  request.body = encoded.body;
  return request;
}

export function parseSubmitResponse(ctx, response) {
  return run(() => submitResult(ctx, response));
}

function submitResult(ctx, response) {
  if (response.statusCode < 200 || response.statusCode >= 300) fail("The upstream returned HTTP " + response.statusCode, "upstream_error", 502);
  if (!ctx.publicTaskId) fail("Missing gateway request ID", "internal_error", 500);
  const prepared = prepare(ctx);
  const result = parseUpstream(prepared.route.protocol, response.body, prepared.ir);
  const client = CLIENTS[prepared.protocol];
  const reply = passthroughReply(prepared.protocol, prepared.route.protocol, result) || client.render(prepared.ir, result, ctx.publicTaskId);
  return {
    taskId: ctx.publicTaskId,
    taskData: { response: reply, usage: result.usage, protocol: prepared.route.protocol },
    immediate: { status: "SUCCESS", progress: "100%" },
  };
}

// The host asks for billing ratios only on its per-call path, taken when the
// model has no task expression: a fixed per-call price, or a ratio, which the
// host turns into a flat charge of half the ratio in dollars per request and
// never settles by tokens. Neither bills tokens, so a token upstream refuses
// it; an upstream without token usage takes the fixed per-call price as is.
function perCallRefusal(ctx) {
  const model = ctx.model;
  if (billingProfile(ctx.upstreamModel || model, model))
    return (
      "Model " + model + " has no decision price. Its model price bills chat; set the plugin price decision::" + model +
      ' with a usage expression such as tier("base", (u("input_tokens") * 0.10 + u("cache_read_tokens") * 0.01 + u("cache_write_tokens") * 0.125) / 1000000)'
    );
  return (
    "Model " + model + " is priced per call or by ratio, which cannot bill decision tokens. Set its model price to a task expression that reads the token usage, " +
    'such as tier("base", u("input_tokens") * 0.042 / 1000000)'
  );
}

export function extractUsage(ctx) {
  return run(function () {
    const prepared = prepare(ctx);
    if (ctx.usagePurpose === "billing_ratios") {
      if (prepared.route.upstream.noUsage) return null;
      fail(perCallRefusal(ctx), "model_price_error");
    }
    return reservationFacts(prepared.ir, ctx.files || [], prepared.route, longContext(ctx), ctx.upstreamModel || ctx.model, ctx.model);
  });
}

export function extractUsageOnComplete(ctx, result, data) {
  // An upstream without token usage is billed per successful request; the
  // protocol was recorded by parseSubmitResponse, never by the client.
  const upstream = isObject(data) && typeof data.protocol === "string" ? UPSTREAMS[data.protocol] : null;
  if (upstream && upstream.noUsage) return requestFacts();
  const usage = usageFromTaskData(data);
  // Throwing keeps the reservation and makes the host log invalid usage; a
  // reply without usage is never billed as free.
  if (!usage) throw new Error("The upstream reply has no token usage; the reserved quota is kept");
  return usageFacts(usage, ctx.upstreamModel || ctx.model, ctx.model);
}

// API v1 requires polling hooks; decisions always complete in the request.
export function buildQueryRequest() {
  throw new Error("Decision requests complete synchronously and have no task to query");
}

export function parseTaskResult() {
  return { status: "UNKNOWN", reason: "Decision requests complete synchronously" };
}

function upstreamBody(message) {
  const start = message.indexOf("{");
  if (start < 0) return null;
  try {
    const value = JSON.parse(message.slice(start));
    return isObject(value) ? value : null;
  } catch (error) {
    return null;
  }
}

function readableMessage(upstream, fallback) {
  if (!upstream) return fallback;
  if (typeof upstream.detail === "string") return upstream.detail;
  if (isObject(upstream.detail) && typeof upstream.detail.message === "string") return upstream.detail.message;
  if (isObject(upstream.error) && typeof upstream.error.message === "string") return upstream.error.message;
  if (typeof upstream.message === "string") return upstream.message;
  return fallback;
}

export const native = {
  decodeSystemOne: decodeAs("systemone"),
  decodeOpenRouter: decodeAs("openrouter"),
  decodeScaleDown: decodeAs("scaledown"),
  decodeDecisions: decodeAs("decisions"),
  decodeOpenAI: decodeAs("openai"),
  decodeGemini: decodeAs("gemini"),
  decodeEvaluate: decodeAs("vercel"),
  decodeDatabricks: decodeAs("databricks"),
  renderDecision: function (ctx, task) {
    if (!isObject(task.data) || task.data.response === undefined) throw new Error("The decision result is unavailable");
    return task.data.response;
  },
  // Every error reaches the client in its own protocol's format: ours carry a
  // status tag; an upstream error body is kept when it already is in that
  // format, otherwise its message is carried over.
  error: function (ctx, error) {
    let value = null;
    try {
      value = clientBody(ctx.body).value;
    } catch (ignored) {
      value = null;
    }
    const protocol = clientProtocol(ctx.path, value) || "systemone";
    let message = String(error.message || "Request failed");
    let status = Number(error.httpStatus) || 500;
    let code = error.code || "";
    const tag = ERROR_TAG.exec(message);
    let upstream = null;
    if (tag) {
      status = Number(tag[1]);
      code = tag[2];
      message = message.replace(ERROR_TAG, "");
    } else {
      // The host may wrap an upstream error body in its own JSON error; unwrap
      // until the vendor's body is reached.
      for (let depth = 0; depth < 3; depth++) {
        const parsed = upstreamBody(message);
        if (!parsed) break;
        upstream = parsed;
        const inner = readableMessage(parsed, message);
        if (inner === message) break;
        message = inner;
      }
    }
    const body = CLIENTS[protocol].error(status, message, code, upstream);
    return { __status: status >= 400 && status <= 599 ? status : 500, __body: body };
  },
};
