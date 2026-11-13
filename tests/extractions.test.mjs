// Extractions: OpenRouter's /api/alpha/extractions format to OpenRouter and to
// Cloudflare Clairic, validation, billing and the decisions/extractions split.
import assert from "node:assert/strict";
import { test } from "node:test";
import { decode, failure, plugin, presentError, run } from "./harness.mjs";
import { CLIENT_BODIES } from "./fixtures.mjs";

const PATH = "/api/alpha/extractions";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
const INVOICE = {
  model: "cloudflare/clairic",
  state: "Invoice INV-7, due 1 Dec 2026. Contact a@example.com. Total 41.50 USD.",
  reference_date: "2026-11-13",
  fields: {
    invoice_number: { type: "text" },
    due_date: { type: "date", instructions: "When payment is due" },
    total: { type: "number", decimals: 2, unit: "USD" },
    contacts: { type: "list", items: "text" },
    days_to_pay: { type: "estimate", min: 0, max: 120, step: 1 },
  },
};
const ex = (patch) => Object.assign({}, INVOICE, patch);
const OPENROUTER = { config: { protocol: "extractions" } };
const CLAIRIC = { config: { protocol: "clairic" }, mapping: { "cloudflare/clairic": "clairic" } };

test("OpenRouter extractions: the body goes as written, the reply in OpenRouter's shape", () => {
  const result = run(PATH, INVOICE, OPENROUTER);
  assert.equal(result.request.url, "https://upstream.example/api/alpha/extractions");
  assert.deepEqual(result.request.body, INVOICE);
  assert.equal(result.reply.id, "task_test_1");
  assert.equal(result.reply.provider, "Cloudflare");
  assert.deepEqual(Object.keys(result.reply.answers), Object.keys(INVOICE.fields));
  assert.equal(result.reply.answers.total.value, 41.5);
  // Token details pass through; the relay's cost is billed, not shown.
  assert.equal(result.reply.usage.schema_tokens, 5);
  assert.equal(result.reply.usage.cost, undefined);
  assert.equal(result.settled.upstream_cost, 0.00002);
  assert.ok(result.settled.input_tokens > 0 && result.settled.requests === 1);
  assert.ok(result.reserved.input_tokens >= result.settled.input_tokens);
});

test("Clairic: images in a top-level array, Cloudflare options, the run envelope unwrapped", () => {
  const request = ex({ state: "Read photo-1", assets: { "photo-1": { type: "image", format: "png", data_base64: PNG } }, provider: { options: { cloudflare: { include_quantiles: true } } } });
  const result = run(PATH, request, CLAIRIC);
  assert.equal(result.request.url, "https://upstream.example/ai/run/@cf/cloudflare/clairic");
  assert.deepEqual(Object.keys(result.request.body), ["model", "state", "fields", "images", "reference_date", "options"]);
  assert.equal(result.request.body.model, "clairic");
  assert.deepEqual(result.request.body.images, [{ content_type: "image/png", base64: PNG }]);
  assert.deepEqual(result.request.body.options, { include_quantiles: true });
  assert.equal(result.reply.model, "clairic");
  assert.equal(result.reply.answers.invoice_number.value, "INV-7");
  // A file-only request sends an empty state.
  const fileOnly = run(PATH, ex({ state: "photo-1", assets: { "photo-1": { format: "jpg", data_base64: PNG } } }), CLAIRIC);
  assert.equal(fileOnly.request.body.state, "");
});

test("Clairic refuses what it cannot read", () => {
  const pdf = failure(() => run(PATH, ex({ state: "", assets: { doc: { type: "document", format: "pdf", data_base64: PNG } } }), CLAIRIC));
  assert.match(pdf.message, /unsupported_modality\] Asset "doc" is a PDF/);
  const assets = {};
  for (let index = 0; index < 5; index++) assets["img-" + index] = { format: "png", data_base64: PNG };
  assert.match(failure(() => run(PATH, ex({ state: "", assets }), CLAIRIC)).message, /at most 4 images/);
  assert.match(failure(() => run(PATH, ex({ fields: { "1st": { type: "text" } } }), CLAIRIC)).message, /Clairic field names/);
  assert.match(failure(() => run(PATH, ex({ provider: { order: ["cloudflare"] } }), CLAIRIC)).message, /unsupported_field\] The request field provider.order/);
});

test("extraction requests are validated like OpenRouter's schema", () => {
  const cases = [
    [ex({ questions: {} }), /send decisions to \/api\/alpha\/decisions/],
    [ex({ extra: 1 }), /does not accept the request field extra/],
    [ex({ model: "" }), /model is required/],
    [ex({ fields: {} }), /fields must be a nonempty object/],
    [ex({ fields: { a: { type: "color" } } }), /must have type text/],
    [ex({ fields: { a: { type: "text", decimals: 2 } } }), /\(text\) does not accept decimals/],
    [ex({ fields: { a: { type: "list" } } }), /needs items/],
    [ex({ fields: { a: { type: "estimate", min: 0 } } }), /needs max/],
    [ex({ fields: { a: { type: "estimate", min: 0, max: 1, null_threshold: 0.5 } } }), /does not accept null_threshold/],
    [ex({ fields: { a: { type: "number", decimals: 7 } } }), /decimals must be an integer from 0 to 6/],
    [ex({ fields: { a: { type: "forecast", min: 0, max: 1, horizon: 65, interval: "day" } } }), /horizon must be an integer from 1 to 64/],
    [ex({ state: "" }), /state may be empty only when the request has assets/],
    [ex({ assets: { "img-1": { format: "png", data_base64: PNG } } }), /Asset "img-1" is not referenced/],
    [ex({ assets: { "img-1": { format: "gif", data_base64: PNG } } }), /format must be png, jpg, jpeg, webp, or pdf/],
    [ex({ reference_date: "13/11/2026" }), /reference_date must be YYYY-MM-DD/],
  ];
  for (const [body, pattern] of cases) assert.match(failure(() => decode(PATH, body)).message, pattern, JSON.stringify(body).slice(0, 120));
  assert.equal(decode("/decision" + PATH, INVOICE).requestBody.protocol, "extractions");
});

test("decisions and extractions never cross", () => {
  const extraction = failure(() => run(PATH, INVOICE, { config: { protocol: "systemone" } }));
  assert.match(extraction.message, /invalid_config\] This is an extractions request, and the channel's upstream protocol systemone serves decisions/);
  const decision = failure(() => run(CLIENT_BODIES.systemone.path, CLIENT_BODIES.systemone.body, { config: { protocol: "extractions" } }));
  assert.match(decision.message, /This is a decisions request/);
  // One channel can serve both with modelProtocols.
  const mixed = { config: { protocol: "systemone", modelProtocols: { "cloudflare/clairic": "extractions" } } };
  assert.equal(run(PATH, INVOICE, mixed).upstream.status, 200);
  assert.equal(run(CLIENT_BODIES.systemone.path, CLIENT_BODIES.systemone.body, mixed).upstream.status, 200);
});

test("extraction errors use OpenRouter's error shape", () => {
  const ours = presentError(PATH, INVOICE, failure(() => decode(PATH, ex({ extra: 1 }))));
  assert.deepEqual(ours.__body, { error: { code: 400, message: "The Extractions API does not accept the request field extra" } });
  const upstream = run(PATH, ex({ model: "fail-429" }), OPENROUTER);
  assert.equal(upstream.error.__status, 429);
  assert.deepEqual(upstream.error.__body, { error: { code: 429, message: "mock 429" } });
  const cloudflare = run(PATH, INVOICE, { config: { protocol: "clairic" }, mapping: { "cloudflare/clairic": "fail-500" } });
  assert.equal(cloudflare.error.__status, 500);
  assert.equal(cloudflare.error.__body.error.message, "mock 500");
});

test("a missing answer is an error, not a blank", () => {
  const reply = { model: "x", answers: { invoice_number: { type: "text", value: null } }, usage: { input_tokens: 5, output_tokens: 0 } };
  assert.match(failure(() => run(PATH, INVOICE, Object.assign({ upstream: () => ({ status: 200, body: reply }) }, OPENROUTER))).message, /The answer to field "due_date" is missing/);
});

test("another New API gets extractions on its own route, Clairic channels included", () => {
  const result = run(PATH, INVOICE, { gateway: true, config: { protocol: "clairic" } });
  assert.equal(result.request.url, "https://upstream.example/decision/api/alpha/extractions");
  assert.deepEqual(result.request.body, INVOICE);
  assert.ok(plugin.meta.models.includes("cloudflare/clairic"));
});
