// Regression tests from the 1.1.0 code audit: names that match an inherited
// object member, __proto__ members, Base URL joining, configuration values
// outside their enums, the gateway image mode and a lone state image.
import assert from "node:assert/strict";
import { test } from "node:test";
import { decode, failure, run } from "./harness.mjs";
import { CLIENT_BODIES } from "./fixtures.mjs";

const S1 = CLIENT_BODIES.systemone;
const OA = CLIENT_BODIES.openai;
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
const s1 = (patch) => Object.assign({}, S1.body, patch);

test("names of inherited object members are ordinary names", () => {
  // A question called constructor is not a duplicate of anything.
  const openai = Object.assign({}, OA.body, { model: "jev-latest", questions: [{ type: "predicate", name: "constructor", instructions: "Is it broken?" }] });
  const result = run(OA.path, openai);
  assert.equal(result.request.body.questions.constructor.type, "noul");
  assert.equal(result.reply.answers[0].name, "constructor");
  // An asset called toString must still be referenced.
  const unreferenced = s1({ assets: { toString: { type: "image", format: "png", data_base64: PNG } } });
  assert.match(failure(() => decode(S1.path, unreferenced)).message, /Asset "toString" is not referenced/);
});

test("type and format values never match an inherited member", () => {
  const asset = s1({ state: "img-1", assets: { "img-1": { type: "image", format: "constructor", data_base64: PNG } } });
  assert.match(failure(() => decode(S1.path, asset)).message, /needs format png, jpg, or jpeg/);
  const openai = Object.assign({}, OA.body, { questions: [{ type: "constructor", name: "q", instructions: "?" }] });
  assert.match(failure(() => decode(OA.path, openai)).message, /unsupported_question_type\] questions\[0\] has type constructor/);
  const vercel = { model: "jev-latest", state: "x", questions: { q: { type: "toString" } } };
  assert.match(failure(() => decode("/v1/evaluate", vercel)).message, /has type toString; use boolean/);
  const extraction = { model: "cloudflare/clairic", state: "x", fields: { a: { type: "constructor" } } };
  assert.match(failure(() => decode("/api/alpha/extractions", extraction)).message, /unsupported_field_type\] Field "a" must have type text/);
});

test("an extraction answer is read only from the reply's own members", () => {
  const request = { model: "cloudflare/clairic", state: "x", fields: { constructor: { type: "text" } } };
  const reply = { model: "x", answers: {}, usage: { input_tokens: 5, output_tokens: 0 } };
  const error = failure(() => run("/api/alpha/extractions", request, { config: { protocol: "extractions" }, upstream: () => ({ status: 200, body: reply }) }));
  assert.match(error.message, /The answer to field "constructor" is missing/);
});

test("__proto__ members are refused instead of dropped", () => {
  const body = JSON.parse('{"model":"jev-latest","state":"x","questions":{"__proto__":{"type":"noul","instructions":"?"}}}');
  assert.match(failure(() => decode(S1.path, body)).message, /cannot use __proto__/);
  const nested = JSON.parse('{"model":"jev-latest","state":{"a":[{"__proto__":1}]},"questions":{"q":{"type":"noul"}}}');
  assert.match(failure(() => decode(S1.path, nested)).message, /cannot use __proto__/);
});

test("the Base URL host is never cut", () => {
  const host = run(S1.path, S1.body, { baseUrl: "http://api", config: { protocol: "openrouter" } });
  assert.equal(host.request.url, "http://api/api/alpha/decisions");
  const port = run(S1.path, S1.body, { baseUrl: "http://v1:8080", config: { path: "/v1/systemone" } });
  assert.equal(port.request.url, "http://v1:8080/v1/systemone");
  // A path that ends with the first segment still is not doubled.
  assert.equal(run(S1.path, S1.body, { baseUrl: "https://relay.example/api/" , config: { protocol: "openrouter" } }).request.url, "https://relay.example/api/alpha/decisions");
  assert.equal(run(S1.path, S1.body, { baseUrl: "https://api.typesafe.ai/v1" }).request.url, "https://api.typesafe.ai/v1/systemone");
});

test("configuration values outside their enums are refused", () => {
  assert.match(failure(() => run(S1.path, S1.body, { config: { protocol: "constructor" } })).message, /invalid_config\] The channel names an unknown upstream protocol constructor/);
  assert.match(failure(() => run(S1.path, S1.body, { config: { authType: "basic" } })).message, /invalid_config\] The channel names an unknown key header type basic/);
  // "none" stays a valid choice.
  assert.equal(run(S1.path, S1.body, { config: { authType: "none" } }).request.headers.Authorization, undefined);
});

test("another New API always gets System One images as assets", () => {
  const input = [{ role: "user", content: [{ type: "input_text", text: "Photo:" }, { type: "input_image", image_url: "data:image/png;base64," + PNG }] }];
  const body = Object.assign({}, OA.body, { model: "jev-latest", input });
  const result = run(OA.path, body, { gateway: true, config: { protocol: "systemone", imageMode: "images-subq" } });
  assert.equal(result.request.url, "https://upstream.example/decision/v1/systemone");
  assert.equal(result.request.body.images, undefined);
  assert.equal(Object.values(result.request.body.assets)[0].data_base64, PNG);
});

test("a lone state image goes as a list of parts", () => {
  const input = [{ role: "user", content: [{ type: "input_image", image_url: "data:image/png;base64," + PNG }] }];
  const body = Object.assign({}, OA.body, { model: "jev-latest", input });
  const result = run(OA.path, body, { config: { protocol: "systemone", imageMode: "state-image-url" } });
  assert.deepEqual(result.request.body.state, [{ type: "image_url", image_url: { url: "data:image/png;base64," + PNG } }]);
});
