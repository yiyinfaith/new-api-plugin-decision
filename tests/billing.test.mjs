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

test("a reply without usage settles as one request, never as zero tokens", () => {
  for (const protocol of ["systemone", "openai", "gemini", "vercel"]) {
    const result = run(S1.path, S1.body, { config: { protocol }, mapping: { "jev-latest": "missing-usage" } });
    assert.ok(result.reply, protocol);
    // No token facts: New API settles a token expression on the reservation's,
    // and a per-request price on this one request.
    assert.deepEqual(result.settled, { requests: 1 }, protocol);
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
  assert.deepEqual(negative.settled, { requests: 1 }, "invalid usage is not read as tokens");
});

test("upstream_cost: a relay's reported cost is billed, never shown to the client", () => {
  // OpenRouter-shaped System One reply with usage.cost (the mock reports 0.0001).
  const openrouter = run(S1.path, S1.body, { config: { protocol: "openrouter" } });
  assert.equal(openrouter.settled.upstream_cost, 0.0001);
  assert.equal(openrouter.reserved.upstream_cost, undefined, "unknown before the reply");
  assert.ok(!JSON.stringify(openrouter.reply).includes("0.0001"));
  // Eden AI: cost at the top level, passed through to a System One client.
  const eden = { model: "typesafe/jev-latest", answers: { wants_refund: { type: "noul", noul: 0.9 }, request: { type: "choice", choice: "refund", confidence: 1, probabilities: { refund: 1 } }, severity: { type: "score", score: 1, confidence: 1, legend: {}, probabilities: {} } }, usage: { input_tokens: 120, output_tokens: 0 }, cost: 0.0000126, provider: "typesafe", id: "edn-1" };
  const viaEden = run(S1.path, S1.body, { upstream: () => ({ status: 200, body: eden }) });
  assert.equal(viaEden.settled.upstream_cost, 0.0000126);
  assert.equal(viaEden.reply.cost, undefined);
  assert.equal(viaEden.reply.provider, "typesafe");
  // OpenAI-shaped relay with usage.cost, on the gpt-6-luna profile.
  const luna = settleWith("gpt-6-luna", { input_tokens: 1000, output_tokens: 0, cost: 0.0001 });
  assert.equal(luna.settled.upstream_cost, 0.0001);
  assert.ok(!("cost" in luna.reply.usage));
  // No cost reported: no fact, so an expression that needs one falls back or fails.
  const plain = run(S1.path, S1.body);
  assert.equal("upstream_cost" in plain.settled, false);
  const negative = settleWith("jev-latest", { input_tokens: 10, output_tokens: 0, cost: -1 });
  assert.equal("upstream_cost" in negative.settled, false);
});

test("perCallPrice: a channel can accept fixed per-call model prices", () => {
  const refused = run(S1.path, S1.body);
  assert.throws(() => plugin.extractUsage(Object.assign({}, refused.ctx, { usagePurpose: "billing_ratios" })), /model_price_error/);
  const accepted = run(S1.path, S1.body, { config: { perCallPrice: true } });
  assert.equal(plugin.extractUsage(Object.assign({}, accepted.ctx, { usagePurpose: "billing_ratios" })), null);
  // Without usage in the reply the request still completes.
  const noUsage = run(S1.path, S1.body, { config: { perCallPrice: true }, mapping: { "jev-latest": "missing-usage" } });
  assert.ok(noUsage.reply.answers);
  assert.equal(plugin.meta.channelConfig.properties.perCallPrice.default, false);
});
