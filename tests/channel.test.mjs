// Channel configuration: protocol, per-model overrides, paths, auth, models.
import assert from "node:assert/strict";
import { test } from "node:test";
import { driverContext, decode, failure, plugin, run } from "./harness.mjs";
import { CLIENT_BODIES } from "./fixtures.mjs";

const OA = CLIENT_BODIES.openai;
const S1 = CLIENT_BODIES.systemone;

test("the default protocol is System One, never guessed from the host", () => {
  const result = run(OA.path, OA.body, { baseUrl: "https://api.openai.com", config: { protocol: undefined } });
  assert.equal(result.request.url, "https://api.openai.com/v1/systemone");
});

test("per-model protocol beats the channel protocol", () => {
  const config = { protocol: "systemone", modelProtocols: { "gpt-6-luna": "openai", "gemini-decision-1": "gemini" } };
  assert.match(run(OA.path, OA.body, { config }).request.url, /\/v1\/decisions$/);
  const gemini = Object.assign({}, OA.body, { model: "gemini-decision-1" });
  assert.match(run(OA.path, gemini, { config }).request.url, /\/v1beta\/decisions$/);
  const jev = Object.assign({}, OA.body, { model: "jev-1.14.0" });
  assert.match(run(OA.path, jev, { config }).request.url, /\/v1\/systemone$/);
});

test("per-model protocols also match the mapped upstream name", () => {
  const config = { modelProtocols: { "real-luna": "openai" } };
  const result = run(OA.path, OA.body, { config, mapping: { "gpt-6-luna": "real-luna" } });
  assert.match(result.request.url, /\/v1\/decisions$/);
  assert.equal(result.request.body.model, "real-luna");
});

test("custom and per-model paths, with {model}", () => {
  const cloudflare = { protocol: "systemone", path: "/client/v4/accounts/acc123/ai/run/@cf/cloudflare/{model}" };
  const result = run(S1.path, S1.body, { baseUrl: "https://api.cloudflare.com", config: cloudflare, mapping: { "jev-latest": "clef" } });
  assert.equal(result.request.url, "https://api.cloudflare.com/client/v4/accounts/acc123/ai/run/@cf/cloudflare/clef");
  // Workers AI wraps the reply in {result, success}; the answers come through.
  assert.equal(result.upstream.body.success, true);
  assert.equal(result.reply.answers.request.choice, "refund");
  const perModel = run(S1.path, S1.body, { config: { path: "/a/v1/systemone", modelPaths: { "jev-latest": "/b/v1/systemone" } } });
  assert.equal(perModel.request.url, "https://upstream.example/b/v1/systemone");
});

test("paths cannot leave the channel host", () => {
  for (const path of ["//evil.example/x", "/../admin", "/a/./b", "https://evil.example/x", "/a b", "/a#frag", "/a\\b", "no-slash"]) {
    const error = failure(() => run(S1.path, S1.body, { config: { path } }));
    assert.match(error.message, /\[decision:500:invalid_config\]/, path);
  }
  // The model placeholder is encoded, so a mapped name cannot add segments either.
  const intent = decode(S1.path, S1.body);
  const ctx = driverContext(intent, { config: { path: "/m/{model}" }, mapping: { "jev-latest": "a?b#c d" } });
  assert.equal(plugin.buildSubmitRequest(ctx).url, "https://upstream.example/m/a%3Fb%23c%20d");
  const climbing = driverContext(intent, { config: { path: "/m/{model}" }, mapping: { "jev-latest": "x/../../admin" } });
  assert.match(failure(() => plugin.buildSubmitRequest(climbing)).message, /cannot contain \. or \.\. segments/);
});

test("key headers", () => {
  const cases = [
    [{ protocol: "gemini" }, "x-goog-api-key"],
    [{ protocol: "openai", authType: "api-key" }, "api-key"],
    [{ protocol: "openai", authType: "x-api-key" }, "x-api-key"],
    [{ protocol: "openai", authType: "custom", authHeader: "X-Vendor-Key" }, "X-Vendor-Key"],
  ];
  for (const [config, name] of cases) {
    const result = run(OA.path, OA.body, { config });
    assert.equal(result.request.headers[name], "sk-upstream-secret", name);
    assert.equal(result.request.headers.Authorization, undefined, name);
  }
  const none = run(OA.path, OA.body, { config: { protocol: "openai", authType: "none" }, upstream: () => ({ status: 200, body: run(OA.path, OA.body, { config: { protocol: "openai" } }).upstream.body }) });
  assert.equal(Object.keys(none.request.headers).filter((name) => /key|authorization/i.test(name)).length, 0);
  assert.match(failure(() => run(OA.path, OA.body, { config: { authType: "custom", authHeader: "Content-Type" } })).message, /cannot be Content-Type/);
  assert.match(failure(() => run(OA.path, OA.body, { config: { authType: "custom", authHeader: "bad header" } })).message, /not a valid header name/);
});

test("any model name through the decision-custom slot", () => {
  for (const name of ["liquid/d1", "custom-decision-model", "openai/gpt-6-luna-decisions-v2"]) {
    const request = Object.assign({}, S1.body, { model: name });
    const result = run(S1.path, request, { mapping: { [name]: "decision-custom" } });
    assert.equal(result.request.body.model, name);
    assert.equal(result.intent.model, name);
  }
  const renamed = run(S1.path, Object.assign({}, S1.body, { model: "my-cheap" }), { mapping: { "my-cheap": "decision-custom" }, config: { upstreamModels: { "my-cheap": "convaiinnovations/laya" } } });
  assert.equal(renamed.request.body.model, "convaiinnovations/laya");
  const direct = failure(() => run(S1.path, Object.assign({}, S1.body, { model: "decision-custom" })));
  assert.match(direct.message, /routing slot/);
});

test("a declared model maps to any upstream ID", () => {
  const result = run(S1.path, S1.body, { mapping: { "jev-latest": "jev-1.13-free" } });
  assert.equal(result.request.body.model, "jev-1.13-free");
  assert.equal(result.intent.model, "jev-latest");
});

test("question limit per channel and per protocol", () => {
  const questions = [];
  for (let index = 0; index < 401; index++) questions.push({ type: "predicate", name: "q" + index, instructions: "Is it " + index + "?" });
  const request = Object.assign({}, OA.body, { questions });
  assert.match(failure(() => run(OA.path, request, { config: { protocol: "openai" } })).message, /at most 400 questions/);
  assert.ok(run(OA.path, request, { config: { protocol: "systemone" } }).reply);
  assert.match(failure(() => run(S1.path, S1.body, { config: { maxQuestions: 2 } })).message, /\[decision:400:limit_exceeded\] This channel accepts at most 2 questions per request and the request has 3/);
});

test("manifest: routes, models, config", () => {
  const paths = plugin.meta.routes.map((route) => route.path);
  assert.deepEqual(paths, ["/v1/systemone", "/typesafe/v1/systemone", "/decisions/v1/systemone", "/providers/microsoft/v1/systemone", "/api/v1/systemone", "/api/alpha/decisions", "/v1/scaledown", "/v1/decisions", "/openai/v1/decisions", "/v1beta/decisions", "/v1/evaluate", "/api/2.0/ai-functions/ai-decide"]);
  for (const route of plugin.meta.routes) {
    assert.equal(route.retainResult, false);
    assert.ok(plugin.native[route.decode], route.decode);
    assert.ok(!route.path.startsWith("/v1/tasks"));
  }
  assert.ok(plugin.meta.models.includes("decision-custom"));
  assert.deepEqual(plugin.meta.usageProfiles.map((profile) => profile.models), [["gpt-6-luna", "openai/gpt-6-luna", "openai/gpt-6-luna-decisions", "gpt-6-luna-decisions"]]);
  assert.equal(plugin.meta.channelConfig.properties.protocol.default, "systemone");
  assert.deepEqual(plugin.meta.requiredCapabilities, ["json-order@1"]);
});

test("decoders are pure and repeatable", () => {
  const first = decode(OA.path, OA.body);
  const second = decode(OA.path, OA.body);
  assert.deepEqual(first, second);
  const ctx = driverContext(first, { config: { protocol: "gemini" } });
  assert.deepEqual(plugin.buildSubmitRequest(ctx), plugin.buildSubmitRequest(ctx));
});

test("the /decision prefix decodes the same way", () => {
  assert.deepEqual(decode("/decision/v1/decisions", OA.body), decode("/v1/decisions", OA.body));
  const s1 = decode("/decision/v1/decisions", S1.body);
  assert.equal(s1.requestBody.protocol, "s1compat");
});
