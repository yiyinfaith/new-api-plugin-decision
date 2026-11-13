// Databricks ai-decide: client validation, conversion limits, per-request
// billing without token usage, errors and the New API gateway upstream.
import assert from "node:assert/strict";
import { test } from "node:test";
import { decode, driverContext, failure, plugin, presentError, run } from "./harness.mjs";
import { CLIENT_BODIES, LEVELS } from "./fixtures.mjs";

const DB = CLIENT_BODIES.databricks;
const S1 = CLIENT_BODIES.systemone;
const OA = CLIENT_BODIES.openai;
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
const DATABRICKS = { config: { protocol: "databricks" } };

const db = (patch) => Object.assign({}, DB.body, patch);
const question = (patch) => db({ questions: { q: Object.assign({ type: "noul", instructions: "Is it?" }, patch) } });

test("the upstream request: documented path, Bearer key, no model member", () => {
  const result = run(OA.path, Object.assign({}, OA.body, { model: "jev-latest" }), Object.assign({ baseUrl: "https://dbc-1.cloud.databricks.com" }, DATABRICKS));
  assert.equal(result.request.url, "https://dbc-1.cloud.databricks.com/api/2.0/ai-functions/ai-decide");
  assert.equal(result.request.headers.Authorization, "Bearer sk-upstream-secret");
  assert.equal(result.request.headers["Content-Type"], "application/json");
  assert.deepEqual(Object.keys(result.request.body), ["state", "questions"]);
  // OpenAI choices and levels become Databricks criteria.
  assert.deepEqual(result.request.body.questions.request.criteria, { refund: "Wants the money back", replacement: "Wants a new mug", other: null });
  assert.deepEqual(result.request.body.questions.severity.criteria, LEVELS);
});

test("any model name routes to ai-decide; the name never reaches it", () => {
  const result = run(DB.path, db({ model: "databricks-decide" }), { config: { protocol: "databricks" }, mapping: { "databricks-decide": "decision-custom" } });
  assert.equal(result.upstream.status, 200);
  assert.equal(result.request.body.model, undefined);
  assert.equal(result.intent.model, "databricks-decide");
});

test("System One values reach ai-decide as written; missing instructions become the question name", () => {
  const request = Object.assign({}, S1.body, { state: ["First note", { order: 7 }] });
  const result = run(S1.path, request, DATABRICKS);
  assert.deepEqual(result.request.body.state, ["First note", { order: 7 }]);
  assert.deepEqual(result.request.body.questions.request, { type: "choice", instructions: "request", criteria: S1.body.questions.request.criteria });
  assert.deepEqual(result.request.body.questions.wants_refund, S1.body.questions.wants_refund);
  // A null noul description has nothing to send.
  const nulls = run(S1.path, Object.assign({}, S1.body, { questions: { q: { type: "noul", instructions: null, criteria: { true: "Yes", false: null } } } }), DATABRICKS);
  assert.deepEqual(nulls.request.body.questions.q, { type: "noul", instructions: "q", criteria: { true: "Yes" } });
});

test("what ai-decide cannot express is refused, never dropped", () => {
  const image = failure(() => run(OA.path, Object.assign({}, OA.body, { model: "jev-latest", input: [{ role: "user", content: [{ type: "input_image", image_url: "data:image/png;base64," + PNG }] }] }), DATABRICKS));
  assert.match(image.message, /\[decision:400:unsupported_modality\] The input contains image content; Databricks ai-decide accepts text and JSON only/);
  const asset = failure(() => run(S1.path, Object.assign({}, S1.body, { state: "See ref-1", assets: { "ref-1": { type: "image", format: "png", data_base64: PNG } } }), DATABRICKS));
  assert.match(asset.message, /unsupported_modality/);
  const box = failure(() => run(S1.path, Object.assign({}, S1.body, { questions: { where: { type: "box", instructions: "Where?" } } }), DATABRICKS));
  assert.match(box.message, /\[decision:400:unsupported_question_type\] Question "where" has type box/);
  const oneLevel = failure(() => run(S1.path, Object.assign({}, S1.body, { questions: { s: { type: "score", criteria: ["Only"] } } }), DATABRICKS));
  assert.match(oneLevel.message, /\[decision:400:limit_exceeded\] Question "s" has 1 levels; Databricks accepts 2 to 10/);
  const developer = failure(() => run(OA.path, Object.assign({}, OA.body, { model: "jev-latest", input: [{ role: "developer", content: "Be strict" }, { role: "user", content: "Text" }] }), DATABRICKS));
  assert.match(developer.message, /unsupported_content/);
  const provider = failure(() => run("/api/alpha/decisions", Object.assign({}, CLIENT_BODIES.openrouter.body, { provider: { order: ["TypeSafe"] } }), DATABRICKS));
  assert.match(provider.message, /\[decision:400:unsupported_field\] The request field provider has no equivalent on Databricks ai-decide/);
});

test("Databricks client validation follows the ai-decide reference", () => {
  const cases = [
    [db({ model: undefined }), /model is required/],
    [db({ extra: 1 }), /does not accept the request field extra/],
    [db({ state: null }), /state must be text, an object, or an array/],
    [db({ questions: {} }), /questions must be a nonempty object/],
    [question({ instructions: undefined }), /needs instructions/],
    [question({ type: "box" }), /must have type noul, choice, or score/],
    [question({ type: "score", criteria: ["Only"] }), /between 2 and 10 levels/],
    [question({ type: "score", criteria: ["Low", " "] }), /nonblank/],
    [question({ type: "choice", criteria: {} }), /between 1 and 255 options/],
    [question({ criteria: { maybe: "?" } }), /accept only true and false/],
    [question({ instructions: " ", criteria: undefined }), /needs instructions or a criteria description/],
    [question({ note: "x" }), /does not accept the member note/],
    [db({ options: { version: "2.0" } }), /options.version must be "1.0"/],
  ];
  for (const [body, pattern] of cases) {
    const request = JSON.parse(JSON.stringify(body));
    assert.match(failure(() => decode(DB.path, request)).message, pattern, JSON.stringify(request).slice(0, 160));
  }
  assert.equal(decode(DB.path, question({ instructions: "", criteria: { true: "Yes" } })).kind, "submit");
  assert.equal(decode("/decision" + DB.path, DB.body).requestBody.protocol, "databricks");
});

test("options.version goes to ai-decide only", () => {
  assert.deepEqual(run(DB.path, DB.body, DATABRICKS).request.body.options, { version: "1.0" });
  const systemone = run(DB.path, DB.body, { config: { protocol: "systemone" } });
  assert.deepEqual(Object.keys(systemone.request.body), ["model", "state", "questions"]);
  assert.deepEqual(systemone.request.body.questions, DB.body.questions);
  assert.equal(run(DB.path, DB.body, { config: { protocol: "openai" } }).request.body.options, undefined);
});

test("per-request billing: one request reserved and settled, no token facts", () => {
  const result = run(DB.path, DB.body, DATABRICKS);
  assert.deepEqual(result.reserved, { requests: 1 });
  assert.deepEqual(result.settled, { requests: 1 });
  // The host's fixed per-call price applies as is.
  assert.equal(plugin.extractUsage(Object.assign({}, result.ctx, { usagePurpose: "billing_ratios" })), null);
  // gpt-6-luna on ai-decide reports no tokens either.
  const luna = run(OA.path, OA.body, DATABRICKS);
  assert.deepEqual(luna.settled, { requests: 1 });
});

test("a Databricks client on a token upstream is billed by tokens", () => {
  const result = run(DB.path, DB.body, { config: { protocol: "systemone" } });
  assert.ok(result.settled.input_tokens > 0);
  assert.equal(result.settled.requests, 1);
  // The client cannot claim per-request billing: the protocol in the task
  // data is the one the plugin sent to.
  assert.equal(result.parsed.taskData.protocol, "systemone");
  assert.throws(() => plugin.extractUsageOnComplete({ model: "jev-latest" }, {}, { response: {}, usage: null, protocol: "systemone" }), /no token usage/);
});

test("token upstreams still refuse per-call and ratio prices, naming the right fix", () => {
  const jev = run(S1.path, S1.body);
  const other = failure(() => plugin.extractUsage(Object.assign({}, jev.ctx, { usagePurpose: "billing_ratios" })));
  assert.match(other.message, /^\[decision:400:model_price_error\] Model jev-latest is priced per call or by ratio, which cannot bill decision tokens\. Set its model price to a task expression/);
  assert.doesNotMatch(other.message, /decision::/);
  const gemini = run(CLIENT_BODIES.gemini.path, CLIENT_BODIES.gemini.body, { config: { protocol: "gemini" } });
  assert.doesNotMatch(failure(() => plugin.extractUsage(Object.assign({}, gemini.ctx, { usagePurpose: "billing_ratios" }))).message, /decision::/);
  const luna = run(OA.path, OA.body, { config: { protocol: "openai" } });
  const lunaError = failure(() => plugin.extractUsage(Object.assign({}, luna.ctx, { usagePurpose: "billing_ratios" })));
  assert.match(lunaError.message, /Model gpt-6-luna has no decision price\. Its model price bills chat; set the plugin price decision::gpt-6-luna/);
});

test("errors in the Databricks format", () => {
  const upstream = run(DB.path, DB.body, { config: { protocol: "databricks", path: "/api/2.0/ai-functions/ai-decide?fail=403" } });
  assert.equal(upstream.error.__status, 403);
  assert.deepEqual(upstream.error.__body, { error_code: "PERMISSION_DENIED", message: "mock 403" });
  const ours = presentError(DB.path, DB.body, failure(() => decode(DB.path, db({ extra: 1 }))));
  assert.equal(ours.__status, 400);
  assert.deepEqual(ours.__body, { error_code: "INVALID_PARAMETER_VALUE", message: "Databricks ai-decide does not accept the request field extra" });
  const limited = run(DB.path, DB.body, { config: { protocol: "systemone" }, mapping: { "jev-latest": "fail-429" } });
  assert.deepEqual(limited.error.__body, { error_code: "RESOURCE_EXHAUSTED", message: "mock 429" });
  // A Databricks error reaches an OpenAI client with its message.
  const openai = run(OA.path, OA.body, { config: { protocol: "databricks", path: "/api/2.0/ai-functions/ai-decide?fail=429" } });
  assert.equal(openai.error.__status, 429);
  assert.equal(openai.error.__body.error.message, "mock 429");
  assert.ok(!JSON.stringify([upstream.error, openai.error]).includes("sk-upstream-secret"));
});

test("a malformed ai-decide reply is an error, not an empty answer", () => {
  const reply = { response: { answers: { wants_refund: { type: "noul", probability: 0.9 }, request: { type: "choice", choice: "refund", probabilities: { refund: 1 }, confidence: 1 } } }, metadata: { version: "1.0" } };
  const missing = failure(() => run(DB.path, DB.body, { config: { protocol: "databricks" }, upstream: () => ({ status: 200, body: reply }) }));
  assert.match(missing.message, /upstream_invalid\] The answer to "severity" is missing/);
  const flat = failure(() => run(DB.path, DB.body, { config: { protocol: "databricks" }, upstream: () => ({ status: 200, body: { answers: {} } }) }));
  assert.match(flat.message, /no response\.answers object/);
  const noul = failure(() => run(DB.path, DB.body, { config: { protocol: "databricks" }, upstream: () => ({ status: 200, body: { response: { answers: { wants_refund: { type: "noul", noul: 0.9 } } } } }) }));
  assert.match(noul.message, /"wants_refund" has no probability/);
});

test("another New API upstream gets the model it routes by", () => {
  const result = run(DB.path, DB.body, { gateway: true, config: { protocol: "databricks" } });
  assert.equal(result.request.url, "https://upstream.example/decision/api/2.0/ai-functions/ai-decide");
  assert.equal(result.request.body.model, "jev-latest");
  assert.equal(result.upstream.status, 200);
  assert.deepEqual(result.settled, { requests: 1 });
  // The AI SDK transport has no model in its body; another gateway serves the
  // evaluation API instead.
  const sdk = run(CLIENT_BODIES.vercel.path, CLIENT_BODIES.vercel.body, { gateway: true, config: { protocol: "vercel_sdk" } });
  assert.equal(sdk.request.url, "https://upstream.example/decision/v1/evaluate");
  assert.equal(sdk.request.body.model, "jev-latest");
  assert.equal(sdk.request.headers["ai-model-id"], undefined);
});

test("the channel form lists ai-decide", () => {
  const protocol = plugin.meta.channelConfig.properties.protocol;
  assert.ok(protocol.enum.includes("databricks"));
  assert.equal(protocol.enum.length, protocol.enumTitles.length);
  assert.ok(plugin.meta.usageSchema.requests);
  for (const example of plugin.meta.usageExamples) assert.deepEqual(Object.keys(example.facts).sort(), Object.keys(plugin.meta.usageSchema).sort());
  assert.ok(plugin.buildSubmitRequest(driverContext(decode(DB.path, DB.body), DATABRICKS)));
});
