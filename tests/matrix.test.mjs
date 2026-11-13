// N x N: every client protocol against every upstream protocol, both
// directions. The mock upstream validates each converted request strictly.
import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./harness.mjs";

import { CLIENT_BODIES, LEVELS } from "./fixtures.mjs";

const UPSTREAMS = ["systemone", "openrouter", "openai", "gemini", "vercel", "vercel_sdk"];
const SCORE = 0.2 + 2 * 0.2;

function checkReply(client, reply) {
  if (client === "openai") {
    assert.equal(reply.answers.length, 3);
    assert.deepEqual(reply.answers[0], { type: "predicate", name: "wants_refund", probability: 0.8 });
    assert.equal(reply.answers[1].type, "choice");
    assert.equal(reply.answers[1].choice, "refund");
    assert.deepEqual(reply.answers[1].probabilities.map((entry) => entry.value), ["refund", "replacement", "other"]);
    assert.equal(reply.answers[1].probabilities[0].probability, 0.6);
    assert.equal(reply.answers[2].type, "score");
    assert.ok(Math.abs(reply.answers[2].score - SCORE) < 1e-9);
    assert.deepEqual(reply.answers[2].probabilities.map((entry) => entry.label), LEVELS);
    assert.ok(Number.isInteger(reply.usage.input_tokens) && reply.usage.input_tokens > 0);
    assert.ok(reply.usage.input_tokens_details);
    return;
  }
  const answers = reply.answers;
  assert.deepEqual(Object.keys(answers), ["wants_refund", "request", "severity"], "question order");
  if (client === "gemini") {
    assert.deepEqual(answers.wants_refund, { type: "noul", noul: 0.8, confidence: 0.8 });
    assert.equal(answers.request.choice, "refund");
    assert.equal(answers.request.confidence, 0.6);
    assert.equal(answers.severity.legend["2"], "Severe");
    assert.ok(Math.abs(answers.severity.score - SCORE) < 1e-9);
    assert.ok(reply.usage.total_input_tokens > 0);
    return;
  }
  if (client === "vercel") {
    assert.deepEqual(answers.wants_refund, { type: "boolean", probability: 0.8 });
    assert.equal(answers.request.choice, "refund");
    assert.equal(answers.request.probabilities.refund, 0.6);
    assert.ok(Math.abs(answers.severity.score - SCORE) < 1e-9);
    assert.ok(reply.usage.inputTokens > 0);
    return;
  }
  // System One family
  assert.equal(answers.wants_refund.type, "noul");
  assert.equal(answers.wants_refund.noul, 0.8);
  assert.equal(answers.request.choice, "refund");
  assert.deepEqual(Object.keys(answers.request.probabilities), ["refund", "replacement", "other"]);
  assert.equal(answers.severity.type, "score");
  assert.ok(Math.abs(answers.severity.score - SCORE) < 1e-9);
  assert.equal(answers.severity.legend["0"], "Minor");
  assert.ok(Number.isInteger(reply.usage.input_tokens) && reply.usage.input_tokens > 0);
  if (client === "openrouter") assert.equal(reply.id, "task_test_1");
}

for (const client of Object.keys(CLIENT_BODIES)) {
  for (const upstream of UPSTREAMS) {
    test(`${client} client -> ${upstream} upstream`, () => {
      const { path, body } = CLIENT_BODIES[client];
      const result = run(path, body, { config: { protocol: upstream } });
      assert.equal(result.upstream.status, 200, JSON.stringify(result.upstream.body));
      checkReply(client, result.reply);
      // The reservation bounds the settled input from above.
      assert.ok(result.settled, String(result.settleError));
      assert.ok(result.reserved.input_tokens >= result.settled.input_tokens, JSON.stringify([result.reserved, result.settled]));
      // The reply goes back with the model that answered.
      if (client !== "gemini" && client !== "vercel") assert.ok(result.reply.model);
    });
  }
}

test("same-protocol requests reach the upstream unchanged except the model", () => {
  for (const [client, upstream] of [["systemone", "systemone"], ["openai", "openai"], ["gemini", "gemini"], ["vercel", "vercel"]]) {
    const { path, body } = CLIENT_BODIES[client];
    const result = run(path, body, { config: { protocol: upstream, upstreamModels: { [body.model]: "vendor-model" } } });
    const sent = Object.assign({}, body, { model: "vendor-model" });
    assert.deepEqual(result.request.body, sent, client);
    assert.deepEqual(Object.keys(result.request.body), Object.keys(body), client + " key order");
  }
});

test("same-protocol replies pass through, with usage in the protocol's standard fields", () => {
  for (const [client, upstream] of [["systemone", "systemone"], ["openai", "openai"], ["gemini", "gemini"]]) {
    const { path, body } = CLIENT_BODIES[client];
    const result = run(path, body, { config: { protocol: upstream } });
    const { usage: replyUsage, ...rest } = result.reply;
    const { usage: upstreamUsage, ...upstreamRest } = result.upstream.body;
    assert.deepEqual(rest, upstreamRest, client);
    assert.ok(replyUsage, client);
  }
});

test("a relay's own cost and billing details stay in the gateway", () => {
  const { path, body } = CLIENT_BODIES.systemone;
  const relay = { model: "jev-1.13-free", answers: { wants_refund: { type: "noul", noul: 0.9 }, request: { type: "choice", choice: "refund", confidence: 1, probabilities: { refund: 1 } }, severity: { type: "score", score: 1, confidence: 1, legend: {}, probabilities: {} } }, usage: { cost: 0, input_tokens: 382, opencode: { billing_source: "free" }, output_tokens: 71 }, vendor_extra: { kept: true } };
  const result = run(path, body, { upstream: () => ({ status: 200, body: relay }) });
  assert.deepEqual(result.reply.usage, { input_tokens: 382, output_tokens: 71 });
  assert.deepEqual(result.reply.vendor_extra, { kept: true });
  assert.equal(result.reply.model, "jev-1.13-free");
});
