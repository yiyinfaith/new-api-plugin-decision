// Parity with the official TypeSafe plugin (1.2.0): validation, member order,
// images, multipart, headers, long context, Box and TypeSafe-format errors.
import assert from "node:assert/strict";
import { test } from "node:test";
import { decode, driverContext, failure, plugin, presentError, run } from "./harness.mjs";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

function body(extra) {
  return Object.assign(
    {
      model: "jev-1.14.0",
      state: { ticket: "The mug is broken.", a_second: 2 },
      questions: {
        request: { type: "choice", criteria: { refund: "Money back", replacement: "New mug", other: null } },
        severity: { type: "score", criteria: ["Minor", "Moderate", "Severe"] },
      },
    },
    extra || {},
  );
}

function rejects(requestBody, pattern) {
  const error = failure(() => decode("/v1/systemone", requestBody));
  assert.match(error.message, pattern);
  return error;
}

test("rejects what TypeSafe rejects", () => {
  rejects(body({ extra: 1 }), /does not accept the request field extra/);
  rejects(Object.assign(body(), { model: "" }), /model is required/);
  rejects(Object.assign(body(), { state: null }), /state must be text, an object, or an array/);
  rejects(Object.assign(body(), { questions: {} }), /questions must be a nonempty object/);
  rejects(body({ questions: { q: { type: "rank" } } }), /must have type choice, score, noul, or box/);
  rejects(body({ questions: { q: { type: "choice", criteria: {} } } }), /between 1 and 255 options/);
  const many = {};
  for (let index = 0; index < 256; index++) many["o" + index] = null;
  rejects(body({ questions: { q: { type: "choice", criteria: many } } }), /between 1 and 255 options/);
  rejects(body({ questions: { q: { type: "score", criteria: [] } } }), /between 1 and 10 levels/);
  rejects(body({ questions: { q: { type: "score", criteria: ["a", null] } } }), /score levels must be text/);
  rejects(body({ questions: { q: { type: "noul", criteria: { true: 5 } } } }), /noul criteria/);
});

test("accepts what TypeSafe 1.2.0 accepts", () => {
  decode("/v1/systemone", body({ questions: { q: { type: "score", criteria: ["Only level"] } } }));
  decode("/v1/systemone", body({ questions: { q: { type: "noul", criteria: { true: "yes", false: null, note: "extra member" } } } }));
  decode("/v1/systemone", body({ questions: { q: { type: "noul", instructions: null } } }));
  decode("/v1/systemone", body({ state: ["first text", { json: true }] }));
});

test("keeps member order of state and questions", () => {
  const request = body({ state: { zeta: 1, alpha: { y: 1, b: 2 } } });
  const result = run("/v1/systemone", request);
  assert.deepEqual(Object.keys(result.request.body), ["model", "state", "questions"]);
  assert.deepEqual(Object.keys(result.request.body.state), ["zeta", "alpha"]);
  assert.deepEqual(Object.keys(result.request.body.state.alpha), ["y", "b"]);
  assert.deepEqual(Object.keys(result.request.body.questions), ["request", "severity"]);
  assert.deepEqual(Object.keys(result.request.body.questions.request.criteria), ["refund", "replacement", "other"]);
});

test("base64 assets send the images header; box questions too", () => {
  const ref = "6f1e0b0c-image";
  const request = body({ state: { photo: ref }, assets: { [ref]: { type: "image", format: "png", data_base64: PNG } } });
  const result = run("/v1/systemone", request);
  assert.equal(result.request.headers["TypeSafe-Danger-Zone-Images"], "true");
  assert.deepEqual(result.request.body.assets, request.assets);
  const boxed = run("/v1/systemone", body({ state: "look", questions: { where: { type: "box", instructions: "Where is the cat?" } } }));
  assert.equal(boxed.request.headers["TypeSafe-Danger-Zone-Images"], "true");
  assert.deepEqual(boxed.reply.answers.where, { type: "box", box: { top: 0.1, bottom: 0.9, left: 0.2, right: 0.8 }, confidence: null });
  assert.equal(run("/v1/systemone", body()).request.headers["TypeSafe-Danger-Zone-Images"], undefined);
});

test("asset validation", () => {
  rejects(body({ assets: { ref: { format: "gif", data_base64: PNG } } }), /format png, jpg, or jpeg/);
  rejects(body({ state: "ref", assets: { ref: { format: "png", data_base64: "data:image/png;base64," + PNG } } }), /standard base64/);
  rejects(body({ assets: { unused: { format: "png", data_base64: PNG } } }), /not referenced/);
  rejects(body({ assets: {} }), /assets must be a nonempty object/);
});

test("multipart uploads go upstream as the SDK sends them", () => {
  const files = [{ ref: "request_file:photo", field: "photo", filename: "cat.png", mimeType: "image/png", size: 1234 }];
  const request = body({ state: "Look at img-1", assets: { "img-1": { type: "image", part: "photo" } } });
  const intent = decode("/v1/systemone", request, { multipart: true, files });
  const ctx = driverContext(intent, { files });
  const descriptor = plugin.buildSubmitRequest(ctx);
  assert.equal(descriptor.bodyType, "multipart");
  assert.equal(descriptor.parts[0].name, "request");
  assert.deepEqual(JSON.parse(descriptor.parts[0].value), Object.assign({}, request, { model: "jev-1.14.0" }));
  assert.deepEqual(descriptor.parts[1], { name: "photo", fileRef: "request_file:photo", filename: "cat.png" });
  assert.equal(descriptor.headers["TypeSafe-Danger-Zone-Images"], "true");
  assert.equal(descriptor.headers["Content-Type"], undefined);
  // An uploaded part no asset names is refused, as TypeSafe does.
  const stray = [files[0], { ref: "request_file:other", field: "other", filename: "x.png", mimeType: "image/png", size: 1 }];
  assert.match(failure(() => decode("/v1/systemone", request, { multipart: true, files: stray })).message, /not named by any asset/);
});

test("long-context header is forwarded and raises the reservation cap", () => {
  const huge = body({ state: "x".repeat(300000) });
  const normal = run("/v1/systemone", huge);
  assert.equal(normal.reserved.input_tokens, 65792);
  assert.equal(normal.request.headers["TypeSafe-Danger-Zone-Long-Context"], undefined);
  const long = run("/v1/systemone", huge, { headers: { "Typesafe-Danger-Zone-Long-Context": "true" } });
  assert.equal(long.request.headers["TypeSafe-Danger-Zone-Long-Context"], "true");
  assert.ok(long.reserved.input_tokens > 65792 && long.reserved.input_tokens <= 262400);
});

test("TypeSafe errors reach the client in TypeSafe's format", () => {
  const result = run("/v1/systemone", body({ model: "jev-latest" }), { mapping: { "jev-latest": "fail-401" } });
  assert.equal(result.error.__status, 401);
  assert.deepEqual(result.error.__body, { detail: "mock 401" });
  const ours = presentError("/v1/systemone", body(), failure(() => decode("/v1/systemone", body({ extra: 1 }))));
  assert.equal(ours.__status, 400);
  assert.deepEqual(ours.__body, { detail: { error_type: "unknown_field", message: "System One does not accept the request field extra" } });
});

test("the official base URL with /v1 still works", () => {
  const result = run("/v1/systemone", body(), { baseUrl: "https://api.typesafe.ai/v1/" });
  assert.equal(result.request.url, "https://api.typesafe.ai/v1/systemone");
});

test("another New API gateway is addressed under /decision with its token", () => {
  const result = run("/v1/systemone", body(), { gateway: true, config: { path: "/ignored" } });
  assert.equal(result.request.url, "https://upstream.example/decision/v1/systemone");
  assert.equal(result.request.headers.Authorization, "Bearer sk-upstream-secret");
});
