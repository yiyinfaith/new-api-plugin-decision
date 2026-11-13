// Protocol registry. Client protocols are what a caller sends to the gateway;
// upstream protocols are what the plugin sends to the channel. Both sides go
// through the Decision IR, so adding a protocol means adding one decoder and
// renderer (client side) and one encoder and parser (upstream side).

import { dbDecode, dbEncode, dbParse, dbRender, dbRenderError } from "./databricks.js";
import { gmDecode, gmEncode, gmParse, gmRender, gmRenderError, gmRenderUsage } from "./gemini.js";
import { oaDecode, oaEncode, oaParse, oaRender, oaRenderError, oaRenderUsage } from "./openai.js";
import { s1Decode, s1Encode, s1Parse, s1Render, s1RenderError, s1RenderUsage } from "./systemone.js";
import { fail, hasOwn, isObject } from "./util.js";
import { vcDecode, vcEncode, vcParse, vcRender, vcRenderError } from "./vercel.js";

// Upstream protocols an administrator can pick per channel or per model.
export const UPSTREAMS = {
  systemone: { family: "systemone", dialect: "typesafe", path: "/v1/systemone", auth: "bearer", maxQuestions: 0, contextTokens: 65792, longContextTokens: 262400 },
  openrouter: { family: "systemone", dialect: "openrouter", path: "/api/alpha/decisions", auth: "bearer", maxQuestions: 0, contextTokens: 262400 },
  openai: { family: "openai", dialect: "openai", path: "/v1/decisions", auth: "bearer", maxQuestions: 400, contextTokens: 1050000 },
  gemini: { family: "gemini", dialect: "gemini", path: "/v1beta/decisions", auth: "x-goog-api-key", maxQuestions: 0, contextTokens: 262144 },
  vercel: { family: "vercel", dialect: "evaluate", path: "/v1/evaluate", auth: "bearer", maxQuestions: 0, contextTokens: 262400 },
  vercel_sdk: { family: "vercel", dialect: "sdk", path: "/v4/ai/evaluation-model", auth: "bearer", maxQuestions: 0, contextTokens: 262400 },
  // Reports no token usage: billed per successful request (see billing.js).
  databricks: { family: "databricks", dialect: "databricks", path: "/api/2.0/ai-functions/ai-decide", auth: "bearer", maxQuestions: 0, contextTokens: 0, noUsage: true },
};

export const UPSTREAM_IDS = Object.keys(UPSTREAMS);

// The path each protocol is served under by this plugin on another gateway.
export const GATEWAY_PATHS = {
  systemone: "/v1/systemone",
  openrouter: "/api/alpha/decisions",
  openai: "/v1/decisions",
  gemini: "/v1beta/decisions",
  vercel: "/v1/evaluate",
  vercel_sdk: "/v1/evaluate",
  databricks: "/api/2.0/ai-functions/ai-decide",
};

// Client protocols: {decode, render, renderError}.
export const CLIENTS = {
  systemone: { family: "systemone", decode: (body, files) => s1Decode(body, "typesafe", files), render: (ir, result, taskId) => s1Render(ir, result, "typesafe", taskId), error: (s, m, c, u) => s1RenderError(s, m, c, u, "typesafe") },
  openrouter: { family: "systemone", decode: (body, files) => s1Decode(body, "openrouter", files), render: (ir, result, taskId) => s1Render(ir, result, "openrouter", taskId), error: (s, m, c, u) => s1RenderError(s, m, c, u, "openrouter") },
  scaledown: { family: "systemone", decode: (body, files) => s1Decode(body, "scaledown", files), render: (ir, result, taskId) => s1Render(ir, result, "typesafe", taskId), error: (s, m, c, u) => s1RenderError(s, m, c, u, "typesafe") },
  s1compat: { family: "systemone", decode: (body, files) => s1Decode(body, "compat", files), render: (ir, result, taskId) => s1Render(ir, result, "typesafe", taskId), error: (s, m, c, u) => oaRenderError(s, m, c, u) },
  openai: { family: "openai", decode: (body) => oaDecode(body), render: (ir, result) => oaRender(ir, result), error: oaRenderError },
  gemini: { family: "gemini", decode: (body) => gmDecode(body), render: (ir, result) => gmRender(ir, result), error: gmRenderError },
  vercel: { family: "vercel", decode: (body) => vcDecode(body), render: (ir, result) => vcRender(ir, result), error: vcRenderError },
  databricks: { family: "databricks", decode: (body) => dbDecode(body), render: (ir, result) => dbRender(ir, result), error: dbRenderError },
};

// Client paths (without the /decision prefix) and the protocol each speaks.
// /v1/decisions carries OpenAI's body, or System One's on Perplexity,
// Inception and Requesty; the body shape tells them apart.
export const CLIENT_ROUTES = [
  { path: "/v1/systemone", protocol: "systemone" },
  { path: "/typesafe/v1/systemone", protocol: "systemone" },
  { path: "/decisions/v1/systemone", protocol: "systemone" },
  { path: "/providers/microsoft/v1/systemone", protocol: "systemone" },
  { path: "/api/v1/systemone", protocol: "openrouter" },
  { path: "/api/alpha/decisions", protocol: "openrouter" },
  { path: "/v1/scaledown", protocol: "scaledown" },
  { path: "/v1/decisions", protocol: "decisions" },
  { path: "/openai/v1/decisions", protocol: "openai" },
  { path: "/v1beta/decisions", protocol: "gemini" },
  { path: "/v1/evaluate", protocol: "vercel" },
  { path: "/api/2.0/ai-functions/ai-decide", protocol: "databricks" },
];

export function routeProtocol(path) {
  let clean = String(path || "").split("?")[0].replace(/\/+$/, "");
  if (clean.startsWith("/decision/")) clean = clean.slice("/decision".length);
  const route = CLIENT_ROUTES.find((item) => item.path === clean);
  return route ? route.protocol : "";
}

// Resolves /v1/decisions by body shape: OpenAI uses an input and a questions
// array; the System One-shaped vendors use a state and a questions object.
export function clientProtocol(path, body) {
  const protocol = routeProtocol(path);
  if (protocol !== "decisions") return protocol;
  if (isObject(body) && (body.state !== undefined || isObject(body.questions))) return "s1compat";
  return "openai";
}

export function encodeUpstream(id, ir, model, newId, options) {
  const upstream = UPSTREAMS[id];
  if (upstream.family === "systemone") return s1Encode(ir, upstream.dialect, model, newId, options || {});
  if (upstream.family === "openai") return oaEncode(ir, model);
  if (upstream.family === "gemini") return gmEncode(ir, model);
  if (upstream.family === "vercel") return vcEncode(ir, model, upstream.dialect === "sdk");
  if (upstream.family === "databricks") return dbEncode(ir, model, !!(options && options.keepModel));
  fail("Unknown upstream protocol " + id, "invalid_config", 500);
}

// Some hosts wrap replies: Cloudflare Workers AI answers {result, success}.
function unwrapReply(body) {
  if (isObject(body) && isObject(body.result) && body.answers === undefined && (body.success !== undefined || body.errors !== undefined)) return body.result;
  return body;
}

export function parseUpstream(id, body, ir) {
  const upstream = UPSTREAMS[id];
  const reply = unwrapReply(body);
  if (isObject(reply) && isObject(reply.error) && reply.answers === undefined)
    fail("The upstream returned an error: " + (typeof reply.error.message === "string" ? reply.error.message : JSON.stringify(reply.error)), "upstream_error", 502);
  let result;
  if (upstream.family === "systemone") result = s1Parse(reply, ir);
  else if (upstream.family === "openai") result = oaParse(reply, ir);
  else if (upstream.family === "gemini") result = gmParse(reply, ir);
  else if (upstream.family === "databricks") result = dbParse(reply, ir);
  else result = vcParse(reply, ir);
  result.reply = reply;
  return result;
}

const REPLY_USAGE = {
  systemone: (usage) => s1RenderUsage(usage, "typesafe"),
  openai: oaRenderUsage,
  gemini: gmRenderUsage,
  // ai-decide replies carry no usage.
  databricks: null,
};

// When the client spoke exactly the upstream's protocol the reply goes back
// as the upstream wrote it, vendor extensions included, except usage: a relay
// may add its own cost and billing details there, which stay in the gateway.
export function passthroughReply(clientId, upstreamId, result) {
  if (clientId !== upstreamId || !hasOwn(REPLY_USAGE, clientId) || !isObject(result.reply)) return null;
  const reply = {};
  for (const key of Object.keys(result.reply)) {
    if (key !== "usage") reply[key] = result.reply[key];
    else if (result.usage && REPLY_USAGE[clientId]) reply.usage = REPLY_USAGE[clientId](result.usage);
  }
  return reply;
}
