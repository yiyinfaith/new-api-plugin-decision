// Content, modality and question-type conversion details, and errors.
import assert from "node:assert/strict";
import { test } from "node:test";
import { decode, failure, presentError, run } from "./harness.mjs";
import { CLIENT_BODIES } from "./fixtures.mjs";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
const OA = CLIENT_BODIES.openai;
const S1 = CLIENT_BODIES.systemone;
const GM = CLIENT_BODIES.gemini;

const oa = (input, extra) => Object.assign({}, OA.body, { model: "jev-latest", input }, extra || {});

test("System One images in text become OpenAI and Gemini image parts", () => {
  const ref = "11111111-2222";
  const request = Object.assign({}, S1.body, { state: "Before " + ref + " after", assets: { [ref]: { type: "image", format: "png", data_base64: PNG } } });
  const openai = run(S1.path, request, { config: { protocol: "openai" } });
  assert.deepEqual(openai.request.body.input, [{ role: "user", content: [{ type: "input_text", text: "Before " }, { type: "input_image", image_url: "data:image/png;base64," + PNG }, { type: "input_text", text: " after" }] }]);
  const gemini = run(S1.path, request, { config: { protocol: "gemini" } });
  assert.deepEqual(gemini.request.body.input, [{ type: "text", text: "Before " }, { type: "image", data: PNG, mime_type: "image/png" }, { type: "text", text: " after" }]);
});

test("OpenAI data-URL images become System One assets with fresh references", () => {
  const result = run(OA.path, oa([{ role: "user", content: [{ type: "input_text", text: "Photo:" }, { type: "input_image", image_url: "data:image/jpeg;base64," + PNG }] }]), { config: { protocol: "systemone" } });
  const assets = result.request.body.assets;
  const [key] = Object.keys(assets);
  assert.deepEqual(assets[key], { type: "image", format: "jpeg", data_base64: PNG });
  assert.deepEqual(result.request.body.state, ["Photo:", key]);
  assert.equal(result.request.headers["TypeSafe-Danger-Zone-Images"], "true");
});

test("image URLs reach OpenAI and Gemini but not System One", () => {
  const request = oa([{ role: "user", content: [{ type: "input_image", image_url: "https://example.com/cat.png" }] }]);
  assert.equal(run(OA.path, request, { config: { protocol: "gemini" } }).request.body.input[0].uri, "https://example.com/cat.png");
  const error = failure(() => run(OA.path, request, { config: { protocol: "systemone" } }));
  assert.match(error.message, /\[decision:400:unsupported_modality\].*not URLs/);
});

test("Gemini audio, video and PDF stay Gemini-only", () => {
  for (const type of ["audio", "video", "document"]) {
    const request = Object.assign({}, GM.body, { model: "jev-latest", input: [{ type: "text", text: "Listen" }, { type, mime_type: type === "document" ? "application/pdf" : type + "/mp4", data: PNG }] });
    const passed = run(GM.path, request, { config: { protocol: "gemini" } });
    assert.equal(passed.request.body.input[1].type, type);
    for (const protocol of ["systemone", "openai"]) {
      const error = failure(() => run(GM.path, request, { config: { protocol } }));
      assert.match(error.message, /unsupported_modality/, type + " -> " + protocol);
    }
  }
});

test("ScaleDown PDF state reaches Gemini as a document block", () => {
  const request = Object.assign({}, CLIENT_BODIES.scaledown.body, { state: { document: PNG, document_mime_type: "application/pdf" } });
  const result = run("/v1/scaledown", request, { config: { protocol: "gemini" } });
  assert.deepEqual(result.request.body.input, [{ type: "document", data: PNG, mime_type: "application/pdf" }]);
  assert.match(failure(() => run("/v1/scaledown", request, { config: { protocol: "openai" } })).message, /unsupported_modality/);
});

test("an image reference inside a JSON state cannot leave System One", () => {
  const ref = "33333333-ref";
  const request = Object.assign({}, S1.body, { state: { photo: ref }, assets: { [ref]: { type: "image", format: "png", data_base64: PNG } } });
  assert.ok(run(S1.path, request, { config: { protocol: "systemone" } }).reply);
  for (const protocol of ["openai", "gemini", "vercel"]) assert.match(failure(() => run(S1.path, request, { config: { protocol } })).message, /image reference inside a JSON object/, protocol);
});

test("box questions: System One and evaluation only", () => {
  const request = Object.assign({}, S1.body, { questions: { where: { type: "box", instructions: "Where?" } } });
  assert.match(failure(() => run(S1.path, request, { config: { protocol: "gemini" } })).message, /unsupported_question_type/);
  const vercel = run(S1.path, request, { config: { protocol: "vercel" } });
  assert.deepEqual(vercel.reply.answers.where.box, { top: 0.1, bottom: 0.9, left: 0.2, right: 0.8 });
  // OpenAI-shaped gateways (Vercel, LiteLLM, Bifrost) extend /v1/decisions with box.
  const openai = run(S1.path, request, { config: { protocol: "openai" } });
  assert.equal(openai.request.body.questions[0].type, "box");
});

test("question limits that differ between protocols are errors, not truncation", () => {
  const one = Object.assign({}, S1.body, { questions: { q: { type: "choice", criteria: { only: null } } } });
  assert.match(failure(() => run(S1.path, one, { config: { protocol: "openai" } })).message, /needs 2 to 255 options/);
  const levels = Array.from({ length: 12 }, (_, i) => "L" + i);
  const many = Object.assign({}, GM.body, { questions: { q: { type: "score", instructions: "Rate", criteria: levels } } });
  assert.match(failure(() => run(GM.path, many, { config: { protocol: "systemone" } })).message, /more than 10 levels/);
  assert.match(failure(() => run(GM.path, many, { config: { protocol: "openai" } })).message, /2 to 10 levels/);
  assert.ok(run(GM.path, many, { config: { protocol: "gemini" } }).reply);
});

test("OpenAI boolean choice values survive a System One round trip", () => {
  const request = oa("text", { questions: [{ type: "choice", name: "flag", instructions: "Which?", choices: [{ value: true }, { value: false }] }] });
  const result = run(OA.path, request, { config: { protocol: "systemone" } });
  assert.deepEqual(Object.keys(result.request.body.questions.flag.criteria), ["true", "false"]);
  assert.equal(result.reply.answers[0].choice, true);
  assert.deepEqual(result.reply.answers[0].probabilities.map((entry) => entry.value), [true, false]);
  const clash = oa("text", { questions: [{ type: "choice", name: "flag", instructions: "Which?", choices: [{ value: true }, { value: "true" }] }] });
  assert.match(failure(() => run(OA.path, clash, { config: { protocol: "systemone" } })).message, /both read "true"/);
});

test("unnamed OpenAI questions get names upstream and come back unnamed", () => {
  const request = oa("text", { questions: [{ type: "predicate", instructions: "A?" }, { type: "predicate", name: "question_0", instructions: "B?" }] });
  const result = run(OA.path, request, { config: { protocol: "gemini" } });
  assert.deepEqual(Object.keys(result.request.body.questions), ["question_1", "question_0"]);
  assert.deepEqual(result.reply.answers.map((answer) => answer.name), [null, "question_0"]);
});

test("OpenAI-only input items are refused elsewhere and kept on OpenAI", () => {
  const request = oa([{ role: "developer", content: "Be strict" }, { role: "user", content: "text" }]);
  assert.ok(run(OA.path, request, { config: { protocol: "openai" } }).reply);
  for (const protocol of ["systemone", "gemini", "vercel"]) assert.match(failure(() => run(OA.path, request, { config: { protocol } })).message, /developer message/, protocol);
});

test("important vendor members are refused where they cannot apply; cache hints are dropped", () => {
  const routed = Object.assign({}, CLIENT_BODIES.openrouter.body, { provider: { max_price: { prompt: 1 } } });
  assert.equal(run("/api/alpha/decisions", routed, { config: { protocol: "openrouter" } }).request.body.provider.max_price.prompt, 1);
  assert.match(failure(() => run("/api/alpha/decisions", routed, { config: { protocol: "systemone" } })).message, /field provider has no equivalent/);
  const cached = oa("text", { prompt_cache_key: "k1" });
  assert.equal(run(OA.path, cached, { config: { protocol: "openai" } }).request.body.prompt_cache_key, "k1");
  assert.equal(run(OA.path, cached, { config: { protocol: "systemone" } }).request.body.prompt_cache_key, undefined);
});

test("an upstream that skips a question fails instead of inventing an answer", () => {
  const error = failure(() =>
    run(S1.path, S1.body, { upstream: () => ({ status: 200, body: { model: "m", answers: { request: { type: "choice", choice: "refund", probabilities: {}, confidence: 1 } }, usage: { input_tokens: 1, output_tokens: 0 } } }) }),
  );
  assert.match(error.message, /\[decision:502:upstream_invalid\] The answer to "wants_refund" is missing/);
  const wrong = failure(() => run(OA.path, OA.body, { config: { protocol: "openai" }, upstream: () => ({ status: 200, body: { answers: [], usage: {} } }) }));
  assert.match(wrong.message, /answered 0 of 3/);
});

test("upstream refusals become each protocol's refusal", () => {
  const reply = { model: "m", answers: [{ type: "refusal", name: "wants_refund" }, { type: "choice", name: "request", choice: "refund", probabilities: [{ value: "refund", probability: 1 }], confidence: 1 }, { type: "score", name: "severity", score: 0, probabilities: [], confidence: 1 }], usage: { input_tokens: 5, output_tokens: 0 } };
  const s1 = run(S1.path, S1.body, { config: { protocol: "openai" }, upstream: () => ({ status: 200, body: reply }) });
  assert.deepEqual(s1.reply.answers.wants_refund, { type: "refusal" });
  const gm = run(GM.path, GM.body, { config: { protocol: "openai" }, upstream: () => ({ status: 200, body: reply }) });
  assert.equal(gm.reply.answers.wants_refund, undefined);
  assert.match(gm.reply.prompt_feedback.block_reason_message, /wants_refund/);
});

test("Gemini blocked input answers every question with a refusal elsewhere", () => {
  const blocked = { answers: {}, usage: { total_input_tokens: 9, total_output_tokens: 0, total_tokens: 9 }, prompt_feedback: { block_reason: "safety" } };
  const result = run(OA.path, OA.body, { config: { protocol: "gemini" }, upstream: () => ({ status: 200, body: blocked }) });
  assert.deepEqual(result.reply.answers.map((answer) => answer.type), ["refusal", "refusal", "refusal"]);
  assert.equal(result.settled.input_tokens, 9);
});

test("errors render in the client's protocol", () => {
  const base = { mapping: { "jev-latest": "fail-429", "gpt-6-luna": "fail-429", "gemini-decision-1": "fail-429" } };
  const openai = run(OA.path, OA.body, Object.assign({ config: { protocol: "systemone" } }, base));
  assert.equal(openai.error.__status, 429);
  assert.deepEqual(openai.error.__body, { error: { message: "mock 429", type: "rate_limit_error", param: null, code: "fail_to_fetch_task" } });
  const gemini = run(GM.path, GM.body, Object.assign({ config: { protocol: "openai" } }, base));
  assert.deepEqual(gemini.error.__body, { error: { code: 429, message: "mock 429", status: "RESOURCE_EXHAUSTED" } });
  const same = run(GM.path, GM.body, Object.assign({ config: { protocol: "gemini" } }, base));
  assert.deepEqual(same.error.__body, { error: { code: 429, message: "mock 429", status: "RESOURCE_EXHAUSTED" } });
  const vercel = presentError("/v1/evaluate", CLIENT_BODIES.vercel.body, failure(() => decode("/v1/evaluate", Object.assign({}, CLIENT_BODIES.vercel.body, { extra: 1 }))));
  assert.deepEqual(vercel.__body, { error: { message: "The evaluation API does not accept the request field extra", type: "unknown_field" } });
  const router = run("/api/alpha/decisions", CLIENT_BODIES.openrouter.body, Object.assign({ config: { protocol: "openrouter" } }, base));
  assert.deepEqual(router.error.__body, { error: { code: 429, message: "mock 429" } });
});

test("error messages never carry the channel key", () => {
  const result = run(OA.path, OA.body, { config: { protocol: "openai" }, mapping: { "gpt-6-luna": "fail-401" } });
  assert.ok(!JSON.stringify(result.error).includes("sk-upstream-secret"));
});

test("Perplexity-style members reach a System One upstream and nothing else", () => {
  const request = { model: "jev-latest", state: "text", mode: "web_grounding", questions: { q: { type: "noul", instructions: "Is it?" } } };
  const sent = run("/v1/decisions", request, { config: { protocol: "systemone", path: "/v1/decisions" }, upstream: () => ({ status: 200, body: { model: "m", answers: { q: { type: "noul", noul: 0.5 } }, usage: { input_tokens: 3, output_tokens: 0 } } }) });
  assert.equal(sent.request.body.mode, "web_grounding");
  assert.match(failure(() => run("/v1/decisions", request, { config: { protocol: "openai" } })).message, /field mode has no equivalent/);
});

test("S1-shaped /v1/decisions keeps extra vendor question types on System One upstreams", () => {
  const request = { model: "jev-latest", state: "text", questions: { where: { type: "locate", instructions: "Find dates" } } };
  const result = run("/v1/decisions", request, { config: { protocol: "systemone" } });
  assert.equal(result.request.body.questions.where.type, "locate");
  assert.deepEqual(result.reply.answers.where, { type: "locate", spans: [] });
  assert.match(failure(() => run("/v1/decisions", request, { config: { protocol: "openai" } })).message, /unsupported_question_type/);
});

test("an upstream error the host wrapped in its own JSON is unwrapped", () => {
  const upstreamBody = JSON.stringify({ detail: "question 'request': no 'instructions'; add the text the model should answer" });
  const wrapped = JSON.stringify({ error: { code: "api_error", message: upstreamBody, param: "", type: "api_error" } });
  const thrown = { message: wrapped };
  const s1 = presentError("/v1/systemone", S1.body, thrown);
  assert.deepEqual(s1.__body, JSON.parse(upstreamBody));
  const router = presentError("/api/alpha/decisions", CLIENT_BODIES.openrouter.body, thrown);
  assert.equal(router.__body.error.message, "question 'request': no 'instructions'; add the text the model should answer");
  const vercel = presentError("/v1/evaluate", CLIENT_BODIES.vercel.body, thrown);
  assert.equal(vercel.__body.error.message, "question 'request': no 'instructions'; add the text the model should answer");
});

test("fillInstructions asks unnamed-instruction questions by name, in both paths", () => {
  const same = run(S1.path, S1.body, { config: { fillInstructions: true } });
  assert.equal(same.request.body.questions.request.instructions, "request");
  assert.deepEqual(Object.keys(same.request.body.questions.request), ["type", "instructions", "criteria"]);
  assert.equal(same.request.body.questions.wants_refund.instructions, "Does the customer want a refund?");
  const converted = run("/v1/evaluate", CLIENT_BODIES.vercel.body, { config: { fillInstructions: true } });
  assert.equal(converted.request.body.questions.request.instructions, "request");
  const off = run(S1.path, S1.body);
  assert.equal(off.request.body.questions.request.instructions, undefined);
});
