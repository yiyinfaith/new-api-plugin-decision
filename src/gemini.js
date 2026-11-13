// Gemini Decisions (POST https://generativelanguage.googleapis.com/v1beta/decisions,
// https://aistudio.google.com/api-reference/decisions). Beta: shared input of
// text, image, audio, video and document blocks; questions keyed by id.

import { contentToText, requireUniqueNames } from "./ir.js";
import { fail, hasOwn, isFiniteNumber, isObject, isStrictBase64 } from "./util.js";

const GM_FIELDS = ["model", "input", "questions"];
const GM_MEDIA = ["image", "audio", "video", "document"];
const GM_MEDIA_EXTRAS = ["resolution", "channels", "sample_rate", "processing", "name"];

function gmBlock(block, where) {
  if (!isObject(block)) fail(where + " must be an object");
  if (block.type === "text") {
    if (typeof block.text !== "string") fail(where + " text block needs text");
    return { t: "text", text: block.text };
  }
  if (GM_MEDIA.indexOf(block.type) >= 0) {
    if (typeof block.mime_type !== "string" || !block.mime_type) fail(where + " needs mime_type");
    const segment = { t: "media", kind: block.type, mime: block.mime_type.toLowerCase() };
    if (typeof block.data === "string" && block.data) {
      if (!isStrictBase64(block.data)) fail(where + " data must be standard base64");
      segment.data = block.data;
    } else if (typeof block.uri === "string" && block.uri) segment.url = block.uri;
    else fail(where + " needs data or uri");
    const extra = {};
    for (const key of GM_MEDIA_EXTRAS) if (block[key] !== undefined) extra[key] = block[key];
    if (Object.keys(extra).length) segment.extra = extra;
    return segment;
  }
  fail(where + " has type " + block.type + "; use text, image, audio, video, or document", "unsupported_content");
}

function gmContent(value, where, textOnly) {
  if (typeof value === "string") return [{ t: "text", text: value }];
  const blocks = Array.isArray(value) ? value : [value];
  if (blocks.length === 0) fail(where + " needs at least one content block");
  return blocks.map(function (block, index) {
    const segment = gmBlock(block, where + "[" + index + "]");
    if (textOnly && segment.t !== "text") fail(where + " takes text blocks only");
    return segment;
  });
}

function gmQuestion(id, question) {
  const where = 'Question "' + id + '"';
  if (!isObject(question)) fail(where + " must be an object");
  if (["noul", "choice", "score"].indexOf(question.type) < 0) fail(where + " has type " + question.type + "; use noul, choice, or score", "unsupported_question_type");
  if (question.instructions === undefined || question.instructions === null) fail(where + " needs instructions");
  const out = { name: id, named: true, type: question.type, instructions: gmContent(question.instructions, where + " instructions", true), raw: question };
  const criteria = question.criteria;
  if (question.type === "noul") {
    if (criteria !== undefined && criteria !== null) {
      if (!isObject(criteria)) fail(where + " criteria must be an object");
      if (typeof criteria.true_description === "string") out.trueText = [{ t: "text", text: criteria.true_description }];
      if (typeof criteria.false_description === "string") out.falseText = [{ t: "text", text: criteria.false_description }];
    }
  } else if (question.type === "choice") {
    if (!isObject(criteria) || Object.keys(criteria).length < 2 || Object.keys(criteria).length > 255) fail(where + " criteria must map 2 to 255 option ids to descriptions");
    out.options = Object.keys(criteria).map(function (key) {
      if (!gmValidOptionId(key)) fail(where + ' option id "' + key + '" must be nonempty without control characters or surrounding spaces');
      const text = criteria[key];
      if (text !== null && typeof text !== "string") fail(where + " option descriptions must be strings");
      return { key: key, value: key, description: typeof text === "string" ? [{ t: "text", text: text }] : null };
    });
  } else {
    if (!Array.isArray(criteria) || criteria.length < 2 || criteria.length > 255) fail(where + " criteria must list 2 to 255 levels");
    out.levels = criteria.map(function (level) {
      if (typeof level !== "string" || !level) fail(where + " levels must be nonempty strings");
      return { description: [{ t: "text", text: level }], source: level };
    });
  }
  return out;
}

function gmValidOptionId(key) {
  return key !== "" && key.trim() === key && !/[\u0000-\u001f\u007f]/.test(key);
}

export function gmDecode(body) {
  if (!isObject(body)) fail("Request body must be a JSON object");
  for (const field of Object.keys(body)) if (GM_FIELDS.indexOf(field) < 0) fail("Gemini Decisions does not accept the request field " + field, "unknown_field");
  if (typeof body.model !== "string" || !body.model.trim()) fail("model is required");
  if (body.input === undefined || body.input === null) fail("input is required");
  if (!isObject(body.questions) || Object.keys(body.questions).length === 0) fail("questions must be a nonempty object");
  return {
    source: { family: "gemini", dialect: "gemini" },
    model: body.model.replace(/^models\//, ""),
    input: gmContent(body.input, "input", false),
    questions: Object.keys(body.questions).map((id) => gmQuestion(id, body.questions[id])),
    extras: { important: {}, ignorable: {} },
    passthrough: body,
  };
}

// ---- upstream encoder -------------------------------------------------------

// An image URL from OpenAI carries no media type; its file extension names it.
const GM_URL_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", heic: "image/heic", heif: "image/heif" };

function gmUrlType(url) {
  const match = /\.([a-z0-9]+)$/i.exec(url.split(/[?#]/)[0]);
  return match ? GM_URL_TYPES[match[1].toLowerCase()] || "" : "";
}

function gmMediaBlock(segment) {
  const block = { type: segment.kind };
  if (segment.url) block.uri = segment.url;
  else if (segment.fileRef) block.data = { __fileRef: segment.fileRef, encoding: "base64" };
  else block.data = segment.data;
  const mime = segment.mime || (segment.url && segment.kind === "image" ? gmUrlType(segment.url) : "");
  if (!mime) fail("Gemini Decisions needs the media type of every image, audio, video, or document; use a URL ending in .png, .jpg or .webp, or inline data", "unsupported_modality");
  block.mime_type = mime;
  if (segment.extra) for (const key of Object.keys(segment.extra)) block[key] = segment.extra[key];
  return block;
}

function gmInput(content) {
  if (!content || content.length === 0) return "";
  if (content.length === 1 && content[0].t === "text") return content[0].text;
  return content.map(function (segment) {
    if (segment.t === "text") return { type: "text", text: segment.text };
    // Gemini has no JSON block; JSON travels as its text, as Vercel's migration
    // guide writes non-message state.
    if (segment.t === "json") {
      if (segment.refs) fail("The input puts an image reference inside a JSON object, which Gemini Decisions cannot express", "unsupported_content");
      return { type: "text", text: JSON.stringify(segment.value) };
    }
    return gmMediaBlock(segment);
  });
}

function gmQuestionFromIR(question) {
  const where = 'Question "' + question.name + '"';
  if (["noul", "choice", "score"].indexOf(question.type) < 0)
    fail(where + " has type " + question.type + ", which Gemini Decisions does not define", "unsupported_question_type");
  if (!gmValidOptionId(question.name)) fail(where + " needs an id without control characters or surrounding spaces on Gemini Decisions");
  const instructions = contentToText(question.instructions, where + " instructions") || question.name;
  const out = { type: question.type, instructions: instructions };
  if (question.type === "noul") {
    const yes = contentToText(question.trueText, where + " criteria");
    const no = contentToText(question.falseText, where + " criteria");
    if (yes || no) {
      out.criteria = {};
      if (yes) out.criteria.true_description = yes;
      if (no) out.criteria.false_description = no;
    }
  } else if (question.type === "choice") {
    if (question.options.length < 2 || question.options.length > 255) fail(where + " needs 2 to 255 options on Gemini Decisions", "limit_exceeded");
    out.criteria = {};
    for (const option of question.options) {
      if (!gmValidOptionId(option.key)) fail(where + ' option "' + option.key + '" is not a valid Gemini option id');
      if (hasOwn(out.criteria, option.key)) fail(where + ' has two options that both read "' + option.key + '" on Gemini Decisions');
      out.criteria[option.key] = contentToText(option.description, where + " option " + option.key);
    }
  } else {
    if (question.levels.length < 2 || question.levels.length > 255) fail(where + " needs 2 to 255 levels on Gemini Decisions", "limit_exceeded");
    out.criteria = question.levels.map(function (level) {
      const description = contentToText(level.description, where + " level");
      const text = level.label !== undefined ? (description ? level.label + ": " + description : level.label) : description;
      if (!text) fail(where + " has an empty level, which Gemini Decisions does not accept");
      return text;
    });
  }
  return out;
}

export function gmEncode(ir, model) {
  if (ir.source.family === "gemini") {
    const body = {};
    for (const key of Object.keys(ir.passthrough)) body[key] = key === "model" ? model : ir.passthrough[key];
    return { body: body };
  }
  if (ir.onlyHere && ir.onlyHere.length) fail("The request has " + ir.onlyHere[0] + ", which Gemini Decisions cannot express", "unsupported_content");
  for (const field of Object.keys(ir.extras.important || {}))
    fail("The request field " + field + " has no equivalent on Gemini Decisions", "unsupported_field");
  requireUniqueNames(ir.questions);
  const questions = {};
  for (const question of ir.questions) questions[question.name] = gmQuestionFromIR(question);
  return { body: { model: model, input: gmInput(ir.input), questions: questions } };
}

// ---- upstream reply ---------------------------------------------------------

function gmConfidence(value) {
  return isFiniteNumber(value) ? value : undefined;
}

function gmLevels(probabilities, count, where) {
  if (probabilities === undefined || probabilities === null) return undefined;
  const levels = [];
  for (let index = 0; index < count; index++) levels.push(null);
  if (Array.isArray(probabilities)) {
    probabilities.forEach(function (value, index) {
      if (index < count && isFiniteNumber(value)) levels[index] = value;
    });
    return levels;
  }
  if (!isObject(probabilities)) fail(where + " probabilities must be an object", "upstream_invalid", 502);
  for (const key of Object.keys(probabilities)) {
    const index = Number(key);
    if (Number.isInteger(index) && index >= 0 && index < count && isFiniteNumber(probabilities[key])) levels[index] = probabilities[key];
  }
  return levels;
}

function gmParseAnswer(answer, question, where) {
  if (!isObject(answer)) fail(where + " is missing", "upstream_invalid", 502);
  if (answer.type !== undefined && answer.type !== question.type) fail(where + " has type " + answer.type + " for a " + question.type + " question", "upstream_invalid", 502);
  if (question.type === "noul") {
    if (!isFiniteNumber(answer.noul)) fail(where + " has no probability", "upstream_invalid", 502);
    return { type: "noul", probability: answer.noul, confidence: gmConfidence(answer.confidence), raw: answer };
  }
  if (question.type === "choice") {
    if (typeof answer.choice !== "string" || !question.options.some((option) => option.key === answer.choice))
      fail(where + " chose an option the question does not have", "upstream_invalid", 502);
    let probabilities;
    if (isObject(answer.probabilities)) {
      probabilities = {};
      for (const key of Object.keys(answer.probabilities)) if (isFiniteNumber(answer.probabilities[key])) probabilities[key] = answer.probabilities[key];
    }
    return { type: "choice", choice: answer.choice, probabilities: probabilities, confidence: gmConfidence(answer.confidence), raw: answer };
  }
  if (!isFiniteNumber(answer.score)) fail(where + " has no score", "upstream_invalid", 502);
  return { type: "score", score: answer.score, probabilities: gmLevels(answer.probabilities, question.levels.length, where), confidence: gmConfidence(answer.confidence), raw: answer };
}

function gmInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

export function gmParseUsage(usage) {
  if (!isObject(usage)) return null;
  const input = gmInteger(usage.total_input_tokens);
  if (input === undefined) return null;
  const output = gmInteger(usage.total_output_tokens) || 0;
  const thoughts = gmInteger(usage.total_thought_tokens) || 0;
  return {
    input: input,
    cacheRead: Math.min(gmInteger(usage.total_cached_tokens) || 0, input),
    cacheWrite: 0,
    output: output,
    reasoning: thoughts,
    total: gmInteger(usage.total_tokens) !== undefined ? usage.total_tokens : input + output + thoughts,
  };
}

export function gmParse(body, ir) {
  if (!isObject(body)) fail("The upstream reply is not a JSON object", "upstream_invalid", 502);
  const feedback = isObject(body.prompt_feedback) ? body.prompt_feedback : null;
  const blocked = feedback && typeof feedback.block_reason === "string" && feedback.block_reason;
  const answers = isObject(body.answers) ? body.answers : {};
  if (!blocked && !isObject(body.answers)) fail("The upstream reply has no answers object", "upstream_invalid", 502);
  const parsed = ir.questions.map(function (question) {
    if (blocked && !hasOwn(answers, question.name)) return { type: "refusal", raw: { block_reason: feedback.block_reason } };
    return gmParseAnswer(hasOwn(answers, question.name) ? answers[question.name] : null, question, 'The answer to "' + question.name + '"');
  });
  return { model: "", answers: parsed, usage: gmParseUsage(body.usage), blocked: blocked ? feedback : null };
}

// ---- client renderer --------------------------------------------------------
// Gemini defines confidence as max(noul, 1 - noul) for noul and the highest
// probability for choice and score, so a Gemini client gets that statistic
// computed from the returned probabilities, never another vendor's figure.

function gmMax(values) {
  let best = null;
  for (const value of values) if (isFiniteNumber(value) && (best === null || value > best)) best = value;
  return best;
}

function gmRenderAnswer(answer, question) {
  if (answer.type === "other") return answer.raw;
  if (answer.type === "noul") return { type: "noul", noul: answer.probability, confidence: Math.max(answer.probability, 1 - answer.probability) };
  if (answer.type === "choice") {
    const out = { type: "choice", choice: answer.choice };
    if (answer.probabilities) {
      out.probabilities = {};
      for (const option of question.options) if (hasOwn(answer.probabilities, option.key)) out.probabilities[option.key] = answer.probabilities[option.key];
      const best = gmMax(Object.keys(out.probabilities).map((key) => out.probabilities[key]));
      if (best !== null) out.confidence = best;
    }
    return out;
  }
  const out = { type: "score", score: answer.score };
  out.legend = {};
  question.levels.forEach(function (level, index) {
    out.legend[String(index)] = level.source !== undefined && typeof level.source === "string" ? level.source : level.label !== undefined ? level.label : contentToText(level.description, "A score level");
  });
  if (answer.probabilities) {
    out.probabilities = {};
    answer.probabilities.forEach(function (value, index) {
      if (isFiniteNumber(value)) out.probabilities[String(index)] = value;
    });
    const best = gmMax(answer.probabilities);
    if (best !== null) out.confidence = best;
  }
  return out;
}

export function gmRenderUsage(usage) {
  const u = usage || { input: 0, cacheRead: 0, output: 0, reasoning: 0, total: 0 };
  return {
    total_input_tokens: u.input,
    total_cached_tokens: u.cacheRead,
    total_output_tokens: u.output,
    total_thought_tokens: u.reasoning,
    total_tokens: u.total || u.input + u.output + u.reasoning,
  };
}

export function gmRender(ir, result) {
  const answers = {};
  const refused = [];
  ir.questions.forEach(function (question, index) {
    const answer = result.answers[index];
    if (answer.type === "refusal") refused.push(question.name);
    else if (answer.type === "box") fail("The upstream answered a box question, which Gemini Decisions cannot express", "unsupported_question_type", 502);
    else answers[question.name] = gmRenderAnswer(answer, question);
  });
  const body = { answers: answers, usage: gmRenderUsage(result.usage) };
  if (result.blocked) body.prompt_feedback = result.blocked;
  else if (refused.length) body.prompt_feedback = { block_reason: "other", block_reason_message: "The model declined to answer: " + refused.join(", ") };
  return body;
}

const GM_STATUS = { 400: "INVALID_ARGUMENT", 401: "UNAUTHENTICATED", 403: "PERMISSION_DENIED", 404: "NOT_FOUND", 413: "INVALID_ARGUMENT", 429: "RESOURCE_EXHAUSTED", 500: "INTERNAL", 502: "UNAVAILABLE", 503: "UNAVAILABLE", 504: "DEADLINE_EXCEEDED" };

export function gmRenderError(status, message, code, upstream) {
  if (isObject(upstream) && isObject(upstream.error) && typeof upstream.error.message === "string" && upstream.error.status !== undefined) return upstream;
  return { error: { code: status, message: message, status: GM_STATUS[status] || (status >= 500 ? "INTERNAL" : "INVALID_ARGUMENT") } };
}
