// Vercel AI Gateway evaluation (POST /v1/evaluate, deprecated in favour of
// /v1/decisions but still served) and the AI SDK decision contract it shares
// (https://ai-sdk.dev/docs/ai-sdk-core/decisions): state plus questions keyed
// by id, with boolean / choice / score / box types, answers keyed by id and
// camelCase usage. The gateway's SDK transport, /v4/ai/evaluation-model with
// the model in the ai-model-id header, carries the same body without model.

import { contentFromSystemOne, contentToSystemOne, contentToText, requireUniqueNames } from "./ir.js";
import { fail, hasOwn, isFiniteNumber, isHttpUrl, isObject, isStrictBase64, own, parseDataUrl, pick } from "./util.js";

const VC_FIELDS = ["model", "state", "questions"];
const VC_IMPORTANT = ["providerOptions"];
const VC_TYPES = { boolean: "noul", noul: "noul", choice: "choice", score: "score", box: "box" };

function vcIsPart(item) {
  return isObject(item) && ((item.type === "text" && typeof item.text === "string") || (item.type === "file" && typeof item.mediaType === "string") || (item.type === "json" && hasOwn(item, "value")));
}

function vcKind(mime) {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

function vcFile(part, where) {
  const mime = part.mediaType.toLowerCase();
  const segment = { t: "media", kind: vcKind(mime), mime: mime };
  const data = part.data;
  if (typeof data !== "string" || !data) fail(where + " file part needs data");
  const dataUrl = parseDataUrl(data);
  if (dataUrl) segment.data = dataUrl.data;
  else if (isHttpUrl(data)) segment.url = data;
  else if (isStrictBase64(data)) segment.data = data;
  else fail(where + " file data must be base64, a data URL, or an http(s) URL");
  return segment;
}

function vcState(state) {
  if (Array.isArray(state) && state.length > 0 && state.every(vcIsPart)) {
    return state.map(function (part, index) {
      if (part.type === "text") return { t: "text", text: part.text };
      if (part.type === "json") return { t: "json", value: part.value, refs: false };
      return vcFile(part, "state[" + index + "]");
    });
  }
  return contentFromSystemOne(state, null);
}

function vcQuestion(id, question) {
  const where = 'Question "' + id + '"';
  if (!isObject(question)) fail(where + " must be an object");
  const type = own(VC_TYPES, question.type);
  if (!type) fail(where + " has type " + question.type + "; use boolean, choice, score, or box", "unsupported_question_type");
  const out = { name: id, named: true, type: type, instructions: contentFromSystemOne(question.instructions, null), raw: question };
  const criteria = question.criteria;
  if (type === "noul" && isObject(criteria)) {
    out.trueText = contentFromSystemOne(criteria.true, null);
    out.falseText = contentFromSystemOne(criteria.false, null);
  } else if (type === "choice") {
    if (!isObject(criteria) || Object.keys(criteria).length === 0) fail(where + " criteria must map each option to a description");
    out.options = Object.keys(criteria).map((key) => ({ key: key, value: key, description: contentFromSystemOne(criteria[key], null) }));
  } else if (type === "score") {
    if (!Array.isArray(criteria) || criteria.length === 0) fail(where + " criteria must list the levels");
    out.levels = criteria.map((level) => ({ description: contentFromSystemOne(level, null), source: level }));
  }
  return out;
}

export function vcDecode(body) {
  if (!isObject(body)) fail("Request body must be a JSON object");
  const extras = { important: {}, ignorable: {} };
  for (const field of Object.keys(body)) {
    if (VC_FIELDS.indexOf(field) >= 0) continue;
    if (VC_IMPORTANT.indexOf(field) >= 0) extras.important[field] = body[field];
    else fail("The evaluation API does not accept the request field " + field, "unknown_field");
  }
  if (typeof body.model !== "string" || !body.model.trim()) fail("model is required");
  if (body.state === undefined || body.state === null) fail("state is required");
  if (!isObject(body.questions) || Object.keys(body.questions).length === 0) fail("questions must be a nonempty object");
  return {
    source: { family: "vercel", dialect: "vercel" },
    model: body.model,
    input: vcState(body.state),
    questions: Object.keys(body.questions).map((id) => vcQuestion(id, body.questions[id])),
    extras: extras,
    passthrough: body,
  };
}

// ---- upstream encoder -------------------------------------------------------

function vcStateFromIR(content) {
  if (!content || content.length === 0) return "";
  if (!content.some((segment) => segment.t === "media")) {
    if (content.some((segment) => segment.t === "json" && segment.refs))
      fail("The input puts an image reference inside a JSON object, which the evaluation API cannot express", "unsupported_content");
    return contentToSystemOne(content, null, "The input");
  }
  return content.map(function (segment) {
    if (segment.t === "text") return { type: "text", text: segment.text };
    if (segment.t === "json") {
      if (segment.refs) fail("The input puts an image reference inside a JSON object, which the evaluation API cannot express", "unsupported_content");
      return { type: "json", value: segment.value };
    }
    if (!segment.mime) fail("The evaluation API needs the media type of every file", "unsupported_modality");
    let data;
    if (segment.url) data = segment.url;
    else if (segment.fileRef) data = { __fileRef: segment.fileRef, encoding: "base64" };
    else data = segment.data;
    return { type: "file", mediaType: segment.mime, data: data };
  });
}

function vcValue(content, where) {
  if (!content || content.length === 0) return undefined;
  if (content.some((segment) => segment.t === "media")) fail(where + " contains media, which the evaluation API accepts only in the state", "unsupported_content");
  return contentToSystemOne(content, null, where);
}

function vcQuestionFromIR(question) {
  const where = 'Question "' + question.name + '"';
  const type = question.type === "noul" ? "boolean" : question.type;
  if (["boolean", "choice", "score", "box"].indexOf(type) < 0) fail(where + " has type " + question.type + ", which the evaluation API does not define", "unsupported_question_type");
  const out = { type: type };
  const instructions = vcValue(question.instructions, where);
  if (instructions !== undefined) out.instructions = instructions;
  if (question.type === "noul") {
    const yes = vcValue(question.trueText, where);
    const no = vcValue(question.falseText, where);
    if (yes !== undefined || no !== undefined) {
      out.criteria = {};
      if (yes !== undefined) out.criteria.true = yes;
      if (no !== undefined) out.criteria.false = no;
    }
  } else if (question.type === "choice") {
    out.criteria = {};
    for (const option of question.options) {
      if (hasOwn(out.criteria, option.key)) fail(where + ' has two options that both read "' + option.key + '" on the evaluation API');
      const description = vcValue(option.description, where);
      out.criteria[option.key] = description === undefined ? null : description;
    }
  } else if (question.type === "score") {
    out.criteria = question.levels.map(function (level) {
      if (level.source !== undefined) return level.source;
      const description = contentToText(level.description, where + " level");
      return level.label !== undefined ? (description ? level.label + ": " + description : level.label) : description;
    });
  }
  return out;
}

export function vcEncode(ir, model, sdk) {
  let body;
  if (ir.source.family === "vercel") {
    body = {};
    for (const key of Object.keys(ir.passthrough)) body[key] = key === "model" ? model : ir.passthrough[key];
  } else {
    if (ir.onlyHere && ir.onlyHere.length) fail("The request has " + ir.onlyHere[0] + ", which the evaluation API cannot express", "unsupported_content");
    for (const field of Object.keys(ir.extras.important || {}))
      fail("The request field " + field + " has no equivalent on the evaluation API", "unsupported_field");
    requireUniqueNames(ir.questions);
    const questions = {};
    for (const question of ir.questions) questions[question.name] = vcQuestionFromIR(question);
    body = { model: model, state: vcStateFromIR(ir.input), questions: questions };
  }
  if (sdk) {
    // The SDK transport names the model in a header and the body has none.
    const stripped = {};
    for (const key of Object.keys(body)) if (key !== "model") stripped[key] = body[key];
    body = stripped;
  }
  return { body: body };
}

// ---- upstream reply ---------------------------------------------------------

function vcMeta(body, name) {
  const metadata = isObject(body.providerMetadata) ? body.providerMetadata : isObject(body.provider_metadata) ? body.provider_metadata : null;
  if (!metadata) return {};
  for (const vendor of Object.keys(metadata)) {
    const entry = metadata[vendor];
    if (isObject(entry) && isObject(entry[name])) return entry[name];
  }
  return {};
}

function vcParseAnswer(answer, question, confidence, where) {
  if (!isObject(answer)) fail(where + " is missing", "upstream_invalid", 502);
  if (answer.type === "refusal") return { type: "refusal", raw: answer };
  const type = own(VC_TYPES, answer.type);
  if (type !== question.type) fail(where + " has type " + answer.type + " for a " + question.type + " question", "upstream_invalid", 502);
  const conf = isFiniteNumber(answer.confidence) ? answer.confidence : isFiniteNumber(confidence) ? confidence : undefined;
  if (type === "noul") {
    const probability = isFiniteNumber(answer.probability) ? answer.probability : answer.noul;
    if (!isFiniteNumber(probability)) fail(where + " has no probability", "upstream_invalid", 502);
    return { type: "noul", probability: probability, confidence: conf, raw: answer };
  }
  if (type === "choice") {
    if (typeof answer.choice !== "string" || !question.options.some((option) => option.key === answer.choice)) fail(where + " chose an option the question does not have", "upstream_invalid", 502);
    let probabilities;
    if (isObject(answer.probabilities)) {
      probabilities = {};
      for (const key of Object.keys(answer.probabilities)) if (isFiniteNumber(answer.probabilities[key])) probabilities[key] = answer.probabilities[key];
    }
    return { type: "choice", choice: answer.choice, probabilities: probabilities, confidence: conf, raw: answer };
  }
  if (type === "score") {
    if (!isFiniteNumber(answer.score)) fail(where + " has no score", "upstream_invalid", 502);
    let levels;
    if (isObject(answer.probabilities)) levels = question.levels.map((level, index) => (isFiniteNumber(answer.probabilities[String(index)]) ? answer.probabilities[String(index)] : null));
    return { type: "score", score: answer.score, probabilities: levels, confidence: conf, raw: answer };
  }
  const box = isObject(answer.box) ? answer.box : answer;
  if (!["top", "bottom", "left", "right"].every((edge) => isFiniteNumber(box[edge]))) fail(where + " has no box coordinates", "upstream_invalid", 502);
  return { type: "box", box: pick(box, ["top", "bottom", "left", "right"]), confidence: conf, raw: answer };
}

function vcInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

export function vcParseUsage(usage) {
  if (!isObject(usage)) return null;
  let input = vcInteger(usage.inputTokens);
  let output = vcInteger(usage.outputTokens);
  if (input === undefined) {
    input = vcInteger(usage.input_tokens);
    output = vcInteger(usage.output_tokens);
  }
  if (input === undefined) return null;
  output = output || 0;
  const cached = vcInteger(usage.cachedInputTokens) || 0;
  return { input: input, cacheRead: Math.min(cached, input), cacheWrite: 0, output: output, reasoning: vcInteger(usage.reasoningTokens) || 0, total: input + output };
}

export function vcParse(body, ir) {
  if (!isObject(body) || !isObject(body.answers)) fail("The upstream reply has no answers object", "upstream_invalid", 502);
  const confidence = vcMeta(body, "confidence");
  const answers = ir.questions.map(function (question) {
    const where = 'The answer to "' + question.name + '"';
    return vcParseAnswer(hasOwn(body.answers, question.name) ? body.answers[question.name] : null, question, confidence[question.name], where);
  });
  return { model: typeof body.model === "string" ? body.model : "", answers: answers, usage: vcParseUsage(body.usage) };
}

// ---- client renderer --------------------------------------------------------

export function vcRender(ir, result) {
  const answers = {};
  const confidence = {};
  const legend = {};
  ir.questions.forEach(function (question, index) {
    const answer = result.answers[index];
    if (isFiniteNumber(answer.confidence)) confidence[question.name] = answer.confidence;
    if (answer.type === "refusal") answers[question.name] = { type: "refusal" };
    else if (answer.type === "other") answers[question.name] = answer.raw;
    else if (answer.type === "noul") answers[question.name] = { type: "boolean", probability: answer.probability };
    else if (answer.type === "choice") {
      const out = { type: "choice", choice: answer.choice };
      if (answer.probabilities) {
        out.probabilities = {};
        for (const option of question.options) if (hasOwn(answer.probabilities, option.key)) out.probabilities[option.key] = answer.probabilities[option.key];
      }
      answers[question.name] = out;
    } else if (answer.type === "score") {
      const out = { type: "score", score: answer.score };
      if (answer.probabilities) {
        out.probabilities = {};
        answer.probabilities.forEach(function (value, position) {
          if (isFiniteNumber(value)) out.probabilities[String(position)] = value;
        });
      }
      legend[question.name] = {};
      question.levels.forEach(function (level, position) {
        legend[question.name][String(position)] = level.source !== undefined ? level.source : level.label !== undefined ? level.label : contentToText(level.description, "A score level");
      });
      answers[question.name] = out;
    } else answers[question.name] = Object.assign({ type: "box" }, answer.box);
  });
  const usage = result.usage || { input: 0, output: 0 };
  const body = { answers: answers, usage: { inputTokens: usage.input, outputTokens: usage.output, totalTokens: usage.input + usage.output } };
  const meta = {};
  if (Object.keys(confidence).length) meta.confidence = confidence;
  if (Object.keys(legend).length) meta.legend = legend;
  if (Object.keys(meta).length) body.providerMetadata = { decision: meta };
  return body;
}

export function vcRenderError(status, message, code, upstream) {
  if (isObject(upstream) && isObject(upstream.error) && typeof upstream.error.message === "string") return upstream;
  return { error: { message: message, type: code || (status >= 500 ? "server_error" : "invalid_request_error") } };
}
