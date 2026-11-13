// Usage facts for New API task billing. The plugin reports quantities only;
// the administrator's expressions set every price.
//
// Default schema (every model): input_tokens excludes cached reads and cache
// writes, so the four fields never count a token twice.
// Special profiles (meta.usageProfiles) exist only where a model's official
// billing needs other fields; adding one is a new entry in SPECIAL_BILLING.

import { base64Bytes, isObject, utf8Length } from "./util.js";

function tokenField(en, zh) {
  return { type: "number", unit: "token", description: { en: en, zh: zh } };
}

export const DEFAULT_SCHEMA = {
  input_tokens: tokenField("Input token unit price", "输入 token 单价"),
  cache_read_tokens: tokenField("Cached input token unit price", "缓存读取 token 单价"),
  cache_write_tokens: tokenField("Cache write token unit price", "缓存写入 token 单价"),
  output_tokens: tokenField("Output token unit price", "输出 token 单价"),
};

export const DEFAULT_EXAMPLES = [
  { label: "1k input", facts: { input_tokens: 1000, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0 } },
  { label: "8k input · 2k cached", facts: { input_tokens: 6000, cache_read_tokens: 2000, cache_write_tokens: 0, output_tokens: 0 } },
];

// OpenAI bills gpt-6-luna decisions for input, cached input and cache writes,
// never for output, and doubles the rates above 272K input tokens.
const LUNA_SCHEMA = {
  input_tokens: tokenField("Input token unit price", "输入 token 单价"),
  cache_read_tokens: tokenField("Cached input token unit price", "缓存读取 token 单价"),
  cache_write_tokens: tokenField("Cache write token unit price", "缓存写入 token 单价"),
  long_context: { type: "boolean", description: { en: "Input longer than 272K tokens", zh: "输入超过 272K token" } },
};

export const SPECIAL_BILLING = [
  {
    models: ["gpt-6-luna", "openai/gpt-6-luna", "openai/gpt-6-luna-decisions", "gpt-6-luna-decisions"],
    schema: LUNA_SCHEMA,
    examples: [
      { label: "1k input", facts: { input_tokens: 1000, cache_read_tokens: 0, cache_write_tokens: 0, long_context: false } },
      { label: "8k input · 6k cached", facts: { input_tokens: 2000, cache_read_tokens: 6000, cache_write_tokens: 0, long_context: false } },
      { label: "300k input", facts: { input_tokens: 300000, cache_read_tokens: 0, cache_write_tokens: 0, long_context: true } },
    ],
    facts: function (usage) {
      return {
        input_tokens: usage.billedInput,
        cache_read_tokens: usage.cacheRead,
        cache_write_tokens: usage.cacheWrite,
        long_context: usage.input > 272000,
      };
    },
  },
];

function fold(name) {
  return String(name || "").toLowerCase();
}

// The host selects the profile of the first of (upstream model, client model)
// that a profile lists, else the default schema; this mirrors it.
export function billingProfile(upstreamModel, model) {
  for (const name of [upstreamModel, model]) {
    for (const profile of SPECIAL_BILLING) {
      if (profile.models.some((declared) => fold(declared) === fold(name))) return profile;
    }
  }
  return null;
}

const MAX_FACT = 2147483647;

function clampTokens(value) {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.floor(value), MAX_FACT);
}

export function usageFacts(usage, upstreamModel, model) {
  const input = clampTokens(usage.input);
  const cacheRead = Math.min(clampTokens(usage.cacheRead), input);
  const cacheWrite = Math.min(clampTokens(usage.cacheWrite), input - cacheRead);
  const normalized = { input: input, cacheRead: cacheRead, cacheWrite: cacheWrite, billedInput: input - cacheRead - cacheWrite, output: clampTokens(usage.output) };
  const profile = billingProfile(upstreamModel, model);
  if (profile) return profile.facts(normalized);
  return { input_tokens: normalized.billedInput, cache_read_tokens: cacheRead, cache_write_tokens: cacheWrite, output_tokens: normalized.output };
}

// ---- reservation ------------------------------------------------------------
// A safe upper bound on input tokens without the vendors' tokenizers: a
// byte-level tokenizer never emits more tokens than the text has UTF-8 bytes,
// media never costs more tokens than its encoded bytes, plus a prompt
// template allowance; capped by the upstream's context limit, past which the
// upstream refuses the request anyway. Settlement replaces it with the usage
// the upstream reports.
const TEMPLATE_TOKENS = 256;
const QUESTION_TOKENS = 64;
const URL_IMAGE_TOKENS = 8192;

function contentBytes(content, files) {
  if (!content) return 0;
  let bytes = 0;
  for (const segment of content) {
    if (segment.t === "text") bytes += utf8Length(segment.text);
    else if (segment.t === "json") bytes += utf8Length(JSON.stringify(segment.value));
    else if (segment.data) bytes += base64Bytes(segment.data);
    else if (segment.fileRef) {
      const file = (files || []).find((item) => item.ref === segment.fileRef);
      bytes += file && Number.isFinite(file.size) ? file.size : Infinity;
    } else bytes += segment.kind === "image" ? URL_IMAGE_TOKENS : Infinity;
  }
  return bytes;
}

export function estimateInputTokens(ir, files) {
  let total = TEMPLATE_TOKENS + contentBytes(ir.input, files);
  for (const question of ir.questions) {
    total += QUESTION_TOKENS + utf8Length(question.name);
    total += contentBytes(question.instructions, files) + contentBytes(question.trueText, files) + contentBytes(question.falseText, files);
    for (const option of question.options || []) total += utf8Length(option.key) + contentBytes(option.description, files);
    for (const level of question.levels || []) total += utf8Length(level.label || "") + contentBytes(level.description, files);
  }
  return total;
}

// Decision outputs are a few tokens per question; reserve a bound for models
// whose administrator prices output.
const OUTPUT_TOKENS_PER_QUESTION = 32;

export function reservationFacts(ir, files, route, longContext, upstreamModel, model) {
  const cap = route.reserveTokens || (longContext && route.upstream.longContextTokens) || route.upstream.contextTokens;
  const tokens = Math.min(estimateInputTokens(ir, files), cap);
  return usageFacts({ input: tokens, cacheRead: 0, cacheWrite: 0, output: OUTPUT_TOKENS_PER_QUESTION * ir.questions.length }, upstreamModel, model);
}

export function usageFromTaskData(data) {
  if (!isObject(data) || !isObject(data.usage)) return null;
  const usage = data.usage;
  if (!Number.isInteger(usage.input) || usage.input < 0) return null;
  return usage;
}
