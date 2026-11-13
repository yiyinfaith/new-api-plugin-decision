// OpenAI Decisions (POST /v1/decisions,
// https://developers.openai.com/api/reference/resources/decisions/methods/create).
// Also Azure OpenAI /openai/v1/decisions, Fireworks /inference/v1/decisions,
// LiteLLM, Bifrost, LLM Gateway, Respan and Vercel /v1/decisions, which use
// the same body. Bifrost reports usage as prompt_tokens/completion_tokens.

import { assignQuestionNames, contentToText, isObjectContent, requireUniqueNames } from "./ir.js";
import { fail, hasOwn, isFiniteNumber, isHttpUrl, isObject, parseDataUrl, pick } from "./util.js";

const OA_FIELDS = ["model", "input", "questions"];
const OA_IGNORABLE = ["prompt_cache_key", "prompt_cache_options", "safety_identifier"];
// Gateway extensions on the same body: Vercel providerOptions, Bifrost fallbacks.
const OA_IMPORTANT = ["providerOptions", "fallbacks"];
const OA_TYPES = { predicate: "noul", choice: "choice", score: "score", box: "box" };
const OA_DETAILS = ["low", "high", "auto", "original"];

function oaText(value, where) {
  if (typeof value === "string") return [{ t: "text", text: value }];
  if (!Array.isArray(value)) fail(where + " must be a string or an array of content parts");
  return value.map(function (part) {
    if (!isObject(part)) fail(where + " has a content part that is not an object");
    if (part.type === "input_text") {
      if (typeof part.text !== "string") fail(where + " has an input_text part without text");
      return { t: "text", text: part.text };
    }
    if (part.type === "input_json") {
      if (!(isObject(part.data) || (Array.isArray(part.data) && part.data.every(isObject))))
        fail(where + " has an input_json part whose data is not an object or an array of objects");
      return { t: "json", value: part.data, refs: false };
    }
    if (part.type === "input_image") return oaImage(part, where);
    fail(where + " has a content part of type " + part.type + ", which OpenAI Decisions does not define", "unsupported_content");
  });
}

function oaImage(part, where) {
  const url = part.image_url;
  if (typeof url !== "string") fail(where + " has an input_image part without image_url");
  const detail = OA_DETAILS.indexOf(part.detail) >= 0 ? part.detail : undefined;
  const data = parseDataUrl(url);
  if (data) return { t: "media", kind: "image", mime: data.mime, data: data.data, detail: detail };
  if (isHttpUrl(url)) return { t: "media", kind: "image", mime: "", url: url, detail: detail };
  fail(where + " has an image_url that is neither a data URL nor an http(s) URL");
}

// The OpenAI input: a string or a list of items. Only user messages carry
// meaning other protocols can hold; other roles and tool items stay OpenAI-only.
function oaInput(input, notes) {
  if (typeof input === "string") return [{ t: "text", text: input }];
  if (!Array.isArray(input)) fail("input must be a string or an array of input items");
  const segments = [];
  input.forEach(function (item, index) {
    const where = "input[" + index + "]";
    if (!isObject(item)) fail(where + " must be an object");
    const role = item.role;
    if (role === "user" && (item.type === undefined || item.type === "message")) {
      segments.push.apply(segments, oaText(item.content, where));
      return;
    }
    notes.push(role ? "a " + role + " message" : "an input item of type " + item.type);
  });
  return segments;
}

function oaQuestion(question, index) {
  const where = "questions[" + index + "]";
  if (!isObject(question)) fail(where + " must be an object");
  const type = OA_TYPES[question.type];
  if (!type) fail(where + " has type " + question.type + "; use predicate, choice, score, or box", "unsupported_question_type");
  const named = typeof question.name === "string" && question.name !== "";
  if (question.name !== undefined && question.name !== null && typeof question.name !== "string") fail(where + " name must be a string");
  if (question.instructions === undefined || question.instructions === null) fail(where + " needs instructions");
  const out = { name: named ? question.name : "", named: named, type: type, instructions: oaText(question.instructions, where + ".instructions"), raw: question };
  if (type === "choice") {
    const choices = question.choices;
    if (!Array.isArray(choices) || choices.length < 2 || choices.length > 255) fail(where + " choices must hold 2 to 255 options");
    const seen = {};
    out.options = choices.map(function (choice, position) {
      if (!isObject(choice) || (typeof choice.value !== "string" && typeof choice.value !== "boolean"))
        fail(where + ".choices[" + position + "] needs a string or boolean value");
      const id = typeof choice.value + ":" + String(choice.value);
      if (seen[id]) fail(where + " has two choices with the value " + JSON.stringify(choice.value));
      seen[id] = true;
      if (choice.description !== undefined && choice.description !== null && typeof choice.description !== "string")
        fail(where + ".choices[" + position + "] description must be a string");
      return {
        key: String(choice.value),
        value: choice.value,
        description: typeof choice.description === "string" ? [{ t: "text", text: choice.description }] : null,
      };
    });
  } else if (type === "score") {
    const levels = question.levels;
    if (!Array.isArray(levels) || levels.length < 2 || levels.length > 10) fail(where + " levels must hold 2 to 10 levels");
    out.levels = levels.map(function (level, position) {
      if (!isObject(level) || typeof level.label !== "string") fail(where + ".levels[" + position + "] needs a label");
      if (level.description !== undefined && level.description !== null && typeof level.description !== "string")
        fail(where + ".levels[" + position + "] description must be a string");
      return { label: level.label, description: typeof level.description === "string" ? [{ t: "text", text: level.description }] : null };
    });
  }
  return out;
}

export function oaDecode(body) {
  if (!isObject(body)) fail("Request body must be a JSON object");
  const extras = { important: {}, ignorable: {} };
  for (const field of Object.keys(body)) {
    if (OA_FIELDS.indexOf(field) >= 0) continue;
    if (OA_IGNORABLE.indexOf(field) >= 0) extras.ignorable[field] = body[field];
    else if (OA_IMPORTANT.indexOf(field) >= 0) extras.important[field] = body[field];
    else fail("OpenAI Decisions does not accept the request field " + field, "unknown_field");
  }
  if (typeof body.model !== "string" || !body.model.trim()) fail("model is required");
  if (body.input === undefined || body.input === null) fail("input is required");
  if (!Array.isArray(body.questions) || body.questions.length === 0) fail("questions must be a nonempty array");
  const notes = [];
  const input = oaInput(body.input, notes);
  const questions = body.questions.map(oaQuestion);
  assignQuestionNames(questions);
  requireUniqueNames(questions);
  return {
    source: { family: "openai", dialect: "openai" },
    model: body.model,
    input: input,
    questions: questions,
    extras: extras,
    passthrough: body,
    onlyHere: notes,
  };
}

// ---- upstream encoder -------------------------------------------------------

function oaImagePart(segment, where) {
  if (segment.kind !== "image")
    fail(where + " contains " + segment.kind + " content; OpenAI Decisions accepts text, JSON and images only", "unsupported_modality");
  const part = { type: "input_image" };
  if (segment.url) part.image_url = segment.url;
  else if (segment.fileRef) {
    if (!segment.mime) fail(where + " has an uploaded image without a PNG or JPEG content type", "unsupported_modality");
    part.image_url = { __fileRef: segment.fileRef, encoding: "dataUrl", mimeType: segment.mime };
  } else part.image_url = "data:" + segment.mime + ";base64," + segment.data;
  if (segment.detail) part.detail = segment.detail;
  return part;
}

function oaParts(content, where) {
  return content.map(function (segment) {
    if (segment.t === "text") return { type: "input_text", text: segment.text };
    if (segment.t === "json") {
      if (segment.refs) fail(where + " puts an image reference inside a JSON object, which OpenAI Decisions cannot express", "unsupported_content");
      if (isObject(segment.value) || (Array.isArray(segment.value) && segment.value.length > 0 && segment.value.every(isObject)))
        return { type: "input_json", data: segment.value };
      return { type: "input_text", text: JSON.stringify(segment.value) };
    }
    return oaImagePart(segment, where);
  });
}

function oaContent(content, where) {
  if (!content || content.length === 0) return "";
  if (content.length === 1 && content[0].t === "text") return content[0].text;
  return oaParts(content, where);
}

function oaFoldCriteria(instructions, question) {
  const yes = contentToText(question.trueText, 'Question "' + question.name + '" criteria');
  const no = contentToText(question.falseText, 'Question "' + question.name + '" criteria');
  if (!yes && !no) return instructions;
  const note = (yes ? "\n\ntrue: " + yes : "\n\n") + (no ? (yes ? "\n" : "") + "false: " + no : "");
  if (typeof instructions === "string") return instructions + note;
  return instructions.concat([{ type: "input_text", text: note }]);
}

function oaQuestionFromIR(question) {
  const where = 'Question "' + question.name + '"';
  const type = question.type === "noul" ? "predicate" : question.type;
  if (["predicate", "choice", "score", "box"].indexOf(type) < 0)
    fail(where + " has type " + question.type + ", which OpenAI Decisions does not define", "unsupported_question_type");
  // OpenAI requires instructions; a System One question without them is
  // asked by its name, which is what System One shows the model.
  let instructions = question.instructions && question.instructions.length ? oaContent(question.instructions, where) : question.name;
  if (question.type === "noul") instructions = oaFoldCriteria(instructions, question);
  const out = { type: type, name: question.name, instructions: instructions };
  if (type === "choice") {
    if (question.options.length < 2 || question.options.length > 255) fail(where + " needs 2 to 255 options on OpenAI Decisions", "limit_exceeded");
    out.choices = question.options.map(function (option) {
      const choice = { value: option.value };
      const description = contentToText(option.description, where + " option " + option.key);
      if (description) choice.description = description;
      return choice;
    });
  } else if (type === "score") {
    if (question.levels.length < 2 || question.levels.length > 10) fail(where + " needs 2 to 10 levels on OpenAI Decisions", "limit_exceeded");
    out.levels = question.levels.map(function (level) {
      if (level.label !== undefined) {
        const entry = { label: level.label };
        const description = contentToText(level.description, where + " level");
        if (description) entry.description = description;
        return entry;
      }
      return { label: contentToText(level.description, where + " level") };
    });
  }
  return out;
}

export function oaEncode(ir, model) {
  if (ir.source.family === "openai") {
    const body = {};
    for (const key of Object.keys(ir.passthrough)) body[key] = key === "model" ? model : ir.passthrough[key];
    return { body: body };
  }
  if (ir.onlyHere && ir.onlyHere.length) fail("The request has " + ir.onlyHere[0] + ", which only OpenAI Decisions accepts", "unsupported_content");
  for (const field of Object.keys(ir.extras.important || {}))
    fail("The request field " + field + " has no equivalent on OpenAI Decisions", "unsupported_field");
  requireUniqueNames(ir.questions);
  let input;
  if (isObjectContent(ir.input)) {
    if (ir.input[0].refs) fail("The input puts an image reference inside a JSON object, which OpenAI Decisions cannot express", "unsupported_content");
    input = [{ role: "user", content: [{ type: "input_json", data: ir.input[0].value }] }];
  }
  else {
    const content = oaContent(ir.input, "The input");
    input = typeof content === "string" ? content : [{ role: "user", content: content }];
  }
  return { body: { model: model, input: input, questions: ir.questions.map(oaQuestionFromIR) } };
}

// ---- upstream reply ---------------------------------------------------------

function oaConfidence(value) {
  return isFiniteNumber(value) ? value : value === null ? null : undefined;
}

function oaParseAnswer(answer, question, where) {
  if (!isObject(answer)) fail(where + " is missing", "upstream_invalid", 502);
  if (answer.type === "refusal") return { type: "refusal", raw: answer };
  const expected = question.type === "noul" ? "predicate" : question.type;
  if (answer.type !== expected) fail(where + " has type " + answer.type + " for a " + expected + " question", "upstream_invalid", 502);
  if (expected === "predicate") {
    if (!isFiniteNumber(answer.probability)) fail(where + " has no probability", "upstream_invalid", 502);
    return { type: "noul", probability: answer.probability, confidence: oaConfidence(answer.confidence), raw: answer };
  }
  if (expected === "choice") {
    const option = question.options.find((item) => item.value === answer.choice) || question.options.find((item) => item.key === String(answer.choice));
    if (!option) fail(where + " chose an option the question does not have", "upstream_invalid", 502);
    let probabilities;
    if (Array.isArray(answer.probabilities)) {
      probabilities = {};
      for (const entry of answer.probabilities) {
        if (!isObject(entry) || !isFiniteNumber(entry.probability)) fail(where + " has an invalid probability entry", "upstream_invalid", 502);
        const match = question.options.find((item) => item.value === entry.value) || question.options.find((item) => item.key === String(entry.value));
        if (match) probabilities[match.key] = entry.probability;
      }
    }
    return { type: "choice", choice: option.key, probabilities: probabilities, confidence: oaConfidence(answer.confidence), raw: answer };
  }
  if (expected === "score") {
    if (!isFiniteNumber(answer.score)) fail(where + " has no score", "upstream_invalid", 502);
    let levels;
    if (Array.isArray(answer.probabilities)) {
      levels = question.levels.map(() => null);
      for (const entry of answer.probabilities) {
        if (!isObject(entry) || !isFiniteNumber(entry.probability)) fail(where + " has an invalid probability entry", "upstream_invalid", 502);
        const index = Number(entry.value);
        if (Number.isInteger(index) && index >= 0 && index < levels.length) levels[index] = entry.probability;
      }
    }
    return { type: "score", score: answer.score, probabilities: levels, confidence: oaConfidence(answer.confidence), raw: answer };
  }
  const box = isObject(answer.box) ? answer.box : answer;
  if (!["top", "bottom", "left", "right"].every((edge) => isFiniteNumber(box[edge]))) fail(where + " has no box coordinates", "upstream_invalid", 502);
  return { type: "box", box: pick(box, ["top", "bottom", "left", "right"]), confidence: oaConfidence(answer.confidence), raw: answer };
}

function oaInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

export function oaParseUsage(usage) {
  if (!isObject(usage)) return null;
  let input = oaInteger(usage.input_tokens);
  let output = oaInteger(usage.output_tokens);
  if (input === undefined && oaInteger(usage.prompt_tokens) !== undefined) {
    input = oaInteger(usage.prompt_tokens);
    output = oaInteger(usage.completion_tokens);
  }
  if (input === undefined) return null;
  const details = isObject(usage.input_tokens_details) ? usage.input_tokens_details : isObject(usage.prompt_tokens_details) ? usage.prompt_tokens_details : {};
  const outputDetails = isObject(usage.output_tokens_details) ? usage.output_tokens_details : {};
  const cacheRead = Math.min(oaInteger(details.cached_tokens) || 0, input);
  const cacheWrite = Math.min(oaInteger(details.cache_write_tokens) || 0, input - cacheRead);
  output = output || 0;
  return {
    input: input,
    cacheRead: cacheRead,
    cacheWrite: cacheWrite,
    output: output,
    reasoning: oaInteger(outputDetails.reasoning_tokens) || 0,
    total: oaInteger(usage.total_tokens) !== undefined ? usage.total_tokens : input + output,
  };
}

export function oaParse(body, ir) {
  if (!isObject(body) || !Array.isArray(body.answers)) fail("The upstream reply has no answers array", "upstream_invalid", 502);
  if (body.answers.length !== ir.questions.length)
    fail("The upstream answered " + body.answers.length + " of " + ir.questions.length + " questions", "upstream_invalid", 502);
  const answers = ir.questions.map(function (question, index) {
    const answer = body.answers[index];
    const where = 'The answer to "' + question.name + '"';
    if (isObject(answer) && typeof answer.name === "string" && answer.name !== question.name)
      fail(where + " came back under the name " + answer.name, "upstream_invalid", 502);
    return oaParseAnswer(answer, question, where);
  });
  return { model: typeof body.model === "string" ? body.model : "", answers: answers, usage: oaParseUsage(body.usage) };
}

// ---- client renderer --------------------------------------------------------

function oaRenderAnswer(answer, question) {
  const name = question.named ? question.name : null;
  if (answer.type === "refusal") return { type: "refusal", name: name };
  if (answer.type === "other") return answer.raw;
  if (answer.type === "noul") return { type: "predicate", name: name, probability: answer.probability };
  if (answer.type === "choice") {
    const chosen = question.options.find((option) => option.key === answer.choice);
    const out = { type: "choice", name: name, choice: chosen ? chosen.value : answer.choice };
    if (answer.probabilities) {
      out.probabilities = question.options
        .filter((option) => hasOwn(answer.probabilities, option.key))
        .map((option) => ({ value: option.value, probability: answer.probabilities[option.key] }));
    }
    out.confidence = answer.confidence === undefined ? null : answer.confidence;
    return out;
  }
  if (answer.type === "score") {
    const out = { type: "score", name: name, score: answer.score };
    if (answer.probabilities) {
      out.probabilities = [];
      question.levels.forEach(function (level, index) {
        const probability = answer.probabilities[index];
        if (probability === null || probability === undefined) return;
        const label = level.label !== undefined ? level.label : contentToText(level.description, "A score level");
        out.probabilities.push({ value: index, label: label, probability: probability });
      });
    }
    out.confidence = answer.confidence === undefined ? null : answer.confidence;
    return out;
  }
  return { type: "box", name: name, box: answer.box, confidence: answer.confidence === undefined ? null : answer.confidence };
}

export function oaRenderUsage(usage) {
  const u = usage || { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0, total: 0 };
  return {
    input_tokens: u.input,
    input_tokens_details: { cached_tokens: u.cacheRead, cache_write_tokens: u.cacheWrite },
    output_tokens: u.output,
    output_tokens_details: { reasoning_tokens: u.reasoning },
    total_tokens: u.total || u.input + u.output,
  };
}

export function oaRender(ir, result) {
  return {
    model: result.model || ir.model,
    answers: ir.questions.map((question, index) => oaRenderAnswer(result.answers[index], question)),
    usage: oaRenderUsage(result.usage),
  };
}

const OA_ERROR_TYPES = { 401: "authentication_error", 403: "permission_error", 404: "not_found_error", 429: "rate_limit_error" };

export function oaRenderError(status, message, code, upstream) {
  if (isObject(upstream) && isObject(upstream.error) && typeof upstream.error.message === "string") return upstream;
  const type = OA_ERROR_TYPES[status] || (status >= 500 ? "server_error" : "invalid_request_error");
  return { error: { message: message, type: type, param: null, code: code || null } };
}
