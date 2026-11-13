// Channel configuration: meta.channelConfig and how a request resolves it.
// Precedence: per-model value > channel value > protocol default.
// The plugin never guesses a protocol from the Base URL or host.

import { UPSTREAM_IDS, UPSTREAMS, GATEWAY_PATHS } from "./protocols.js";
import { fail, isObject } from "./util.js";

// Declared routing slot: map any client model name to it in the channel's
// model mapping, and the client's name (or upstreamModels[name]) is sent.
export const CUSTOM_SLOT = "decision-custom";

const PROTOCOL_TITLES = [
  { en: "TypeSafe System One", zh: "TypeSafe System One" },
  { en: "OpenRouter decisions", zh: "OpenRouter Decisions" },
  { en: "OpenAI Decisions", zh: "OpenAI Decisions" },
  { en: "Gemini Decisions", zh: "Gemini Decisions" },
  { en: "Vercel evaluation", zh: "Vercel Evaluation" },
  { en: "Vercel AI SDK transport", zh: "Vercel AI SDK 内部接口" },
  { en: "Databricks ai-decide (no token usage, billed per request)", zh: "Databricks ai-decide（无 token 用量，按次计费）" },
];

export const AUTH_TYPES = ["auto", "bearer", "x-goog-api-key", "api-key", "x-api-key", "custom", "none"];

export const CHANNEL_CONFIG = {
  type: "object",
  properties: {
    protocol: {
      type: "string",
      title: { en: "Upstream protocol", zh: "上游协议" },
      description: { en: "Request format sent to this channel", zh: "发往本渠道的请求格式" },
      enum: UPSTREAM_IDS,
      enumTitles: PROTOCOL_TITLES,
      default: "systemone",
    },
    path: {
      type: "string",
      title: { en: "Upstream path", zh: "上游路径" },
      description: { en: "Leave empty for the protocol's default path; {model} stands for the upstream model", zh: "留空使用协议默认路径；{model} 代表上游模型" },
      maxLength: 512,
      default: "",
    },
    authType: {
      type: "string",
      title: { en: "Key header", zh: "密钥请求头" },
      enum: AUTH_TYPES,
      enumTitles: [
        { en: "Protocol default", zh: "协议默认" },
        { en: "Authorization: Bearer", zh: "Authorization: Bearer" },
        { en: "x-goog-api-key", zh: "x-goog-api-key" },
        { en: "api-key", zh: "api-key" },
        { en: "x-api-key", zh: "x-api-key" },
        { en: "Custom header", zh: "自定义请求头" },
        { en: "No key", zh: "不发送密钥" },
      ],
      default: "auto",
    },
    authHeader: {
      type: "string",
      title: { en: "Custom key header name", zh: "自定义密钥请求头名" },
      maxLength: 128,
      default: "",
      visibleWhen: { authType: "custom" },
    },
    modelProtocols: {
      type: "object",
      title: { en: "Upstream protocol per model", zh: "按模型指定上游协议" },
      additionalProperties: { type: "string", title: { en: "Upstream protocol", zh: "上游协议" }, enum: UPSTREAM_IDS },
    },
    modelPaths: {
      type: "object",
      title: { en: "Upstream path per model", zh: "按模型指定上游路径" },
      additionalProperties: { type: "string", title: { en: "Upstream path", zh: "上游路径" }, maxLength: 512 },
    },
    upstreamModels: {
      type: "object",
      title: { en: "Upstream model ID per model", zh: "按模型指定上游模型 ID" },
      additionalProperties: { type: "string", title: { en: "Upstream model ID", zh: "上游模型 ID" }, maxLength: 256 },
    },
    fillInstructions: {
      type: "boolean",
      title: { en: "Ask questions without instructions by their name", zh: "缺少指令时用问题名补上" },
      description: { en: "For upstreams that require instructions on every question", zh: "用于要求每题都有指令的上游" },
      default: false,
    },
    maxQuestions: {
      type: "integer",
      title: { en: "Questions per request", zh: "单次问题数上限" },
      description: { en: "0 uses the protocol limit", zh: "0 表示使用协议上限" },
      minimum: 0,
      maximum: 100000,
      default: 0,
    },
    reserveTokens: {
      type: "integer",
      title: { en: "Input tokens to reserve at most", zh: "最多预扣输入 token" },
      description: { en: "0 uses the protocol context limit", zh: "0 表示使用协议上下文上限" },
      minimum: 0,
      maximum: 2000000,
      default: 0,
    },
  },
};

function perModel(config, field, names) {
  const map = isObject(config) && isObject(config[field]) ? config[field] : null;
  if (!map) return undefined;
  for (const name of names) {
    if (name && typeof map[name] === "string" && map[name].trim()) return map[name].trim();
  }
  return undefined;
}

// A path may hold letters, digits and - . _ ~ / : @ % + , ; = ! $ & ' ( ) * and a
// query; never a scheme, host, fragment, backslash, whitespace or .. segment.
export function validatePath(path, where) {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) fail(where + " must start with a single /", "invalid_config", 500);
  if (/[\s\\#\u0000-\u001f\u007f]/.test(path) || path.indexOf("://") >= 0) fail(where + " contains characters a path cannot hold", "invalid_config", 500);
  const pathname = path.split("?")[0];
  if (pathname.split("/").some((segment) => segment === ".." || segment === ".")) fail(where + " cannot contain . or .. segments", "invalid_config", 500);
  if (!/^[A-Za-z0-9\-._~/:@%+,;=!$&'()*?{}]*$/.test(path)) fail(where + " contains characters a path cannot hold", "invalid_config", 500);
  return path;
}

function encodeModel(model) {
  return encodeURIComponent(model).replace(/%2F/gi, "/").replace(/%40/gi, "@").replace(/%3A/gi, ":");
}

// Joins the Base URL and the path. A Base URL that already ends with the
// path's first segment (https://api.typesafe.ai/v1 + /v1/systemone) is not
// doubled, as the official TypeSafe plugin accepts.
export function joinUrl(baseUrl, path) {
  let base = String(baseUrl || "").replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(base)) fail("The channel Base URL must be an http(s) address", "invalid_config", 500);
  const first = "/" + path.split("/")[1];
  if (first.length > 1 && base.toLowerCase().endsWith(first.toLowerCase()) && path.length > first.length) base = base.slice(0, -first.length);
  return base + path;
}

// Everything a request needs to reach its upstream.
export function resolveChannel(ctx) {
  const config = isObject(ctx.config) ? ctx.config : {};
  const clientModel = ctx.model;
  const mapped = ctx.upstreamModel || ctx.model;
  const names = [clientModel, mapped];
  let protocol = perModel(config, "modelProtocols", names) || (typeof config.protocol === "string" && config.protocol) || "systemone";
  if (!UPSTREAMS[protocol]) fail("The channel names an unknown upstream protocol " + protocol, "invalid_config", 500);
  const gateway = ctx.upstream && ctx.upstream.kind === "new_api";
  // Another New API serves the AI SDK body at /v1/evaluate, which names the model.
  if (gateway && protocol === "vercel_sdk") protocol = "vercel";
  let model = perModel(config, "upstreamModels", names);
  if (!model) {
    if (mapped === CUSTOM_SLOT) {
      if (clientModel === CUSTOM_SLOT) fail(CUSTOM_SLOT + " is a routing slot: map a model name to it in the channel's model mapping, or set its upstream model ID", "invalid_model");
      model = clientModel;
    } else model = mapped;
  }
  const upstream = UPSTREAMS[protocol];
  let path;
  if (gateway) path = "/decision" + GATEWAY_PATHS[protocol];
  else path = perModel(config, "modelPaths", names) || (typeof config.path === "string" && config.path.trim()) || upstream.path;
  path = validatePath(path, "The upstream path");
  // Checked again after substitution, so a model name cannot add . or .. segments.
  path = validatePath(path.split("{model}").join(encodeModel(model)), "The upstream path with the model");
  const headers = {};
  const key = ctx.apiKey || "";
  let auth = gateway ? "bearer" : typeof config.authType === "string" ? config.authType : "auto";
  if (auth === "auto") auth = upstream.auth;
  if (auth === "bearer") headers.Authorization = gateway && ctx.authHeader ? ctx.authHeader : "Bearer " + key;
  else if (auth === "x-goog-api-key" || auth === "api-key" || auth === "x-api-key") headers[auth] = key;
  else if (auth === "custom") {
    const name = typeof config.authHeader === "string" ? config.authHeader.trim() : "";
    if (!/^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/.test(name)) fail("The channel's custom key header name is not a valid header name", "invalid_config", 500);
    if (/^(host|content-length|content-type|connection|transfer-encoding|cookie)$/i.test(name)) fail("The channel's custom key header cannot be " + name, "invalid_config", 500);
    headers[name] = key;
  }
  const maxQuestions = Number.isInteger(config.maxQuestions) && config.maxQuestions > 0 ? config.maxQuestions : upstream.maxQuestions;
  const reserveTokens = Number.isInteger(config.reserveTokens) && config.reserveTokens > 0 ? config.reserveTokens : 0;
  return {
    protocol: protocol,
    upstream: upstream,
    model: model,
    url: joinUrl(ctx.baseUrl, path),
    headers: headers,
    maxQuestions: maxQuestions,
    reserveTokens: reserveTokens,
    fillInstructions: config.fillInstructions === true,
    // Another New API routes even an ai-decide request by its model.
    keepModel: !!gateway,
  };
}
