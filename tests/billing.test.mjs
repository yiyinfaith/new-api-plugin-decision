// Usage facts: default schema, the gpt-6-luna profile, cache tokens,
// reservations and missing usage.
import assert from "node:assert/strict";
import { test } from "node:test";
import { failure, plugin, run } from "./harness.mjs";
import { CLIENT_BODIES } from "./fixtures.mjs";

const OA = CLIENT_BODIES.openai;
const S1 = CLIENT_BODIES.systemone;

function settleWith(model, usage, mapping) {
  const reply = { model: model, answers: OA.body.questions.map((q, i) => (i === 0 ? { type: "predicate", name: q.name, probability: 0.5 } : i === 1 ? { type: "choice", name: q.name, choice: "refund", probabilities: [{ value: "refund", probability: 1 }], confidence: 1 } : { type: "score", name: q.name, score: 1, probabilities: [], confidence: 1 })), usage };
  return run(OA.path, Object.assign({}, OA.body, { model }), { config: { protocol: "openai" }, mapping, upstream: () => ({ status: 200, body: reply }) });
}

test("gpt-6-luna: input, cached and cache-write tokens, never output", () => {
  const result = settleWith("gpt-6-luna", { input_tokens: 10000, input_tokens_details: { cached_tokens: 6000, cache_write_tokens: 1000 }, output_tokens: 12, total_tokens: 10012 });
  assert.deepEqual(result.settled, { input_tokens: 3000, cache_read_tokens: 6000, cache_write_tokens: 1000, long_context: false });
  assert.deepEqual(Object.keys(result.reserved), ["input_tokens", "cache_read_tokens", "cache_write_tokens", "long_context"]);
});

test("gpt-6-luna above 272K input tokens is long context", () => {
  const result = settleWith("gpt-6-luna", { input_tokens: 300000, output_tokens: 0 });
  assert.equal(result.settled.long_context, true);
  assert.equal(result.settled.input_tokens, 300000);
});

test("an alias of gpt-6-luna keeps the luna profile, a mapped deployment name too", () => {
  const alias = settleWith("my-luna", { input_tokens: 10, output_tokens: 0 }, { "my-luna": "gpt-6-luna" });
  assert.ok("long_context" in alias.settled);
  const deployment = settleWith("gpt-6-luna", { input_tokens: 10, output_tokens: 0 }, { "gpt-6-luna": "my-azure-deployment" });
  assert.ok("long_context" in deployment.settled);
});

test("other models use the default schema with output tokens", () => {
  const result = settleWith("gemini-decision-1", { input_tokens: 500, input_tokens_details: { cached_tokens: 100 }, output_tokens: 7 });
  assert.deepEqual(result.settled, { input_tokens: 400, cache_read_tokens: 100, cache_write_tokens: 0, output_tokens: 7, requests: 1 });
});

test("vendor usage shapes", () => {
  const bifrost = run(OA.path, Object.assign({}, OA.body, { model: "jev-latest" }), { config: { protocol: "openai" }, mapping: { "jev-latest": "bifrost-usage" } });
  assert.ok(bifrost.settled.input_tokens > 0);
  const gemini = run(OA.path, Object.assign({}, OA.body, { model: "jev-latest" }), { config: { protocol: "gemini" } });
  assert.equal(gemini.settled.cache_read_tokens, 2);
  const openrouter = run(S1.path, S1.body, { config: { protocol: "openrouter" } });
  assert.equal(openrouter.settled.cache_read_tokens, 3);
  const vercel = run(S1.path, S1.body, { config: { protocol: "vercel" } });
  assert.ok(vercel.settled.input_tokens > 0);
});

test("a reply without usage keeps the reservation instead of billing zero", () => {
  for (const protocol of ["systemone", "openai", "gemini", "vercel"]) {
    const result = run(S1.path, S1.body, { config: { protocol }, mapping: { "jev-latest": "missing-usage" } });
    assert.ok(result.reply, protocol);
    assert.equal(result.settled, undefined, protocol);
    assert.match(String(result.settleError), /no token usage/, protocol);
  }
});

test("clients cannot set their own usage", () => {
  // Usage fields in a request are refused, never read.
  const error = failure(() => run(S1.path, Object.assign({}, S1.body, { usage: { input_tokens: 0 } })));
  assert.match(error.message, /does not accept the request field usage/);
});

test("reservation: bounded by bytes and by the channel or context cap", () => {
  const small = run(S1.path, S1.body);
  assert.ok(small.reserved.input_tokens < 2000);
  const capped = run(S1.path, S1.body, { config: { reserveTokens: 300 } });
  assert.equal(capped.reserved.input_tokens, 300);
  const urlImage = run(OA.path, Object.assign({}, OA.body, { model: "jev-latest", input: [{ role: "user", content: [{ type: "input_image", image_url: "https://example.com/a.png" }] }] }), { config: { protocol: "openai" } });
  assert.ok(urlImage.reserved.input_tokens >= 8192);
  const legacy = failure(() => plugin.extractUsage(Object.assign({}, small.ctx, { usagePurpose: "billing_ratios" })));
  assert.match(legacy.message, /\[decision:400:model_price_error\] Model jev-latest is priced per call or by ratio/);
});

test("settled facts are bounded integers", () => {
  const result = settleWith("jev-latest", { input_tokens: 2147483647, output_tokens: 1 });
  assert.equal(result.settled.input_tokens, 2147483647);
  const negative = settleWith("jev-latest", { input_tokens: -5, output_tokens: 1 });
  assert.equal(negative.settled, undefined);
});
