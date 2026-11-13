// Vendor formats: Parallel's own API, Cloudflare Workers AI openai/decisions,
// the image modes of System One-compatible vendors, and vendor question types.
import assert from "node:assert/strict";
import { test } from "node:test";
import { failure, plugin, run } from "./harness.mjs";
import { CLIENT_BODIES } from "./fixtures.mjs";

const S1 = CLIENT_BODIES.systemone;
const OA = CLIENT_BODIES.openai;
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
const oa = (input) => Object.assign({}, OA.body, { model: "jev-latest", input });
const imageInput = [{ role: "user", content: [{ type: "input_text", text: "Photo:" }, { type: "input_image", image_url: "data:image/png;base64," + PNG }] }];

test("Parallel: no model, x-api-key, instructions on every question", () => {
  const result = run(S1.path, S1.body, { baseUrl: "https://api.parallel.ai", config: { protocol: "parallel" } });
  assert.equal(result.request.url, "https://api.parallel.ai/v1/decisions");
  assert.equal(result.request.headers["x-api-key"], "sk-upstream-secret");
  assert.equal(result.request.headers.Authorization, undefined);
  assert.deepEqual(Object.keys(result.request.body), ["state", "questions"]);
  // Missing instructions become the name; a null option description its key.
  assert.deepEqual(result.request.body.questions.request, { type: "choice", instructions: "request", criteria: { refund: "Wants the money back", replacement: "Wants a new mug", other: "other" } });
  assert.equal(result.reply.answers.wants_refund.noul, 0.8);
  // Parallel bills per request.
  assert.equal(result.settled.requests, 1);
  // Converted from OpenAI too.
  assert.equal(run(OA.path, Object.assign({}, OA.body, { model: "jev-latest" }), { config: { protocol: "parallel" } }).upstream.status, 200);
});

test("Parallel refuses what it cannot take", () => {
  const one = Object.assign({}, S1.body, { questions: { q: { type: "choice", instructions: "Pick", criteria: { only: null } } } });
  assert.match(failure(() => run(S1.path, one, { config: { protocol: "parallel" } })).message, /limit_exceeded\] Question "q" has 1 options; Parallel accepts 2 to 255/);
  assert.match(failure(() => run(OA.path, oa(imageInput), { config: { protocol: "parallel" } })).message, /Parallel decisions take no images/);
  const named = Object.assign({}, S1.body, { questions: { "bad name": { type: "noul", instructions: "?" } } });
  assert.match(failure(() => run(S1.path, named, { config: { protocol: "parallel" } })).message, /Parallel question names/);
  const box = Object.assign({}, S1.body, { questions: { where: { type: "box", instructions: "Where?" } } });
  assert.match(failure(() => run(S1.path, box, { config: { protocol: "parallel" } })).message, /Parallel supports noul, choice, and score/);
});

test("Cloudflare openai/decisions: OpenAI's body inside {model, input}, envelope unwrapped", () => {
  const options = { baseUrl: "https://api.cloudflare.com/client/v4/accounts/abc", config: { protocol: "cloudflare_openai", upstreamModels: { "gpt-6-luna": "openai/decisions" } } };
  const result = run(OA.path, OA.body, options);
  assert.equal(result.request.url, "https://api.cloudflare.com/client/v4/accounts/abc/ai/run");
  assert.deepEqual(Object.keys(result.request.body), ["model", "input"]);
  assert.equal(result.request.body.model, "openai/decisions");
  assert.deepEqual(result.request.body.input, (({ model, ...rest }) => rest)(OA.body));
  assert.equal(result.reply.answers[0].probability, 0.8);
  assert.ok(result.settled.input_tokens > 0);
  // Data URLs only.
  const url = [{ role: "user", content: [{ type: "input_image", image_url: "https://example.com/a.png" }] }];
  assert.match(failure(() => run(OA.path, Object.assign({}, OA.body, { input: url }), options)).message, /data URLs, not image URLs/);
  // From System One as well.
  assert.equal(run(S1.path, Object.assign({}, S1.body, { model: "gpt-6-luna" }), options).upstream.status, 200);
});

test("Cloudflare's error envelope reaches the client as a message", () => {
  const envelope = { success: false, errors: [{ code: 7003, message: "Could not route to /accounts/abc/ai/run" }], messages: [], result: null };
  const http = run(OA.path, OA.body, { config: { protocol: "cloudflare_openai" }, upstream: () => ({ status: 404, body: envelope }) });
  assert.equal(http.error.__status, 404);
  assert.equal(http.error.__body.error.message, "Could not route to /accounts/abc/ai/run");
  assert.match(failure(() => run(OA.path, OA.body, { config: { protocol: "cloudflare_openai" }, upstream: () => ({ status: 200, body: envelope }) })).message, /upstream_error\] The upstream returned an error: Could not route/);
});

test("image modes: each System One-compatible vendor gets images its own way", () => {
  const send = (imageMode) => run(OA.path, oa(imageInput), { config: { protocol: "systemone", imageMode } });
  const subq = send("images-subq");
  assert.deepEqual(subq.request.body.images, [{ mediaType: "image/png", base64: PNG }]);
  assert.equal(subq.request.body.state, "Photo:");
  assert.equal(subq.request.body.assets, undefined);
  assert.equal(subq.request.headers["TypeSafe-Danger-Zone-Images"], undefined);
  assert.deepEqual(send("images-cloudflare").request.body.images, [{ content_type: "image/png", base64: PNG }]);
  assert.deepEqual(send("images-base64").request.body.images, [PNG]);
  const perplexity = send("state-image-url").request.body;
  assert.deepEqual(perplexity.state, ["Photo:", { type: "image_url", image_url: { url: "data:image/png;base64," + PNG } }]);
  assert.equal(perplexity.images, undefined);
  // The default stays TypeSafe's assets.
  assert.ok(send("assets").request.body.assets);
});

test("image modes: System One assets and uploads convert; the rest is refused", () => {
  const ref = "img-1";
  const request = Object.assign({}, S1.body, { state: "Look at " + ref, assets: { [ref]: { type: "image", format: "png", data_base64: PNG } } });
  const result = run(S1.path, request, { config: { imageMode: "images-subq" } });
  assert.equal(result.request.body.assets, undefined);
  assert.deepEqual(result.request.body.images, [{ mediaType: "image/png", base64: PNG }]);
  assert.equal(result.request.body.state, "Look at ");
  const files = [{ ref: "file:photo:0", field: "photo", filename: "cat.png", mimeType: "image/png", size: 68 }];
  const upload = run(S1.path, Object.assign({}, S1.body, { state: ref, assets: { [ref]: { type: "image", part: "photo" } } }), { multipart: true, files, config: { imageMode: "images-base64" } });
  assert.deepEqual(upload.request.body.images, [{ __fileRef: "file:photo:0", encoding: "base64" }]);
  const inInstructions = Object.assign({}, S1.body, { questions: { q: { type: "noul", instructions: "Is " + ref + " a cat?" } }, state: "x", assets: { [ref]: { type: "image", format: "png", data_base64: PNG } } });
  assert.match(failure(() => run(S1.path, inInstructions, { config: { imageMode: "images-subq" } })).message, /takes images in the shared input only/);
  const url = [{ role: "user", content: [{ type: "input_image", image_url: "https://example.com/a.png" }] }];
  assert.match(failure(() => run(OA.path, oa(url), { config: { imageMode: "state-image-url" } })).message, /takes images as base64, not URLs/);
  assert.deepEqual(plugin.meta.channelConfig.properties.imageMode.enum, ["assets", "images-base64", "images-subq", "images-cloudflare", "state-image-url"]);
});

test("vendor question types reach System One upstreams and nothing else", () => {
  const request = Object.assign({}, S1.body, { questions: { total: { type: "number", instructions: "What is the order total?" } } });
  const result = run(S1.path, request);
  assert.deepEqual(result.request.body.questions, request.questions);
  assert.deepEqual(result.reply.answers.total, { type: "number", number: 25.5, text: "25.5", confidence: 0.99 });
  assert.match(failure(() => run(S1.path, request, { config: { protocol: "openai" } })).message, /unsupported_question_type/);
});
