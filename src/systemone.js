// TypeSafe System One (https://docs.typesafe.ai/api, https://api.typesafe.ai/openapi.json)
// and its dialects: OpenRouter decisions (/api/alpha/decisions, /api/v1/systemone),
// ScaleDown (/v1/scaledown) and System One-shaped /v1/decisions endpoints
// (Perplexity, Inception, Requesty).
//
// Request validation follows the official TypeSafe plugin
// (QuantumNous/new-api-plugins, plugins/tasks/typesafe 1.2.0, AGPL-3.0).

import {
  contentFromSystemOne,
  contentToSystemOne,
  contentToText,
  requireUniqueNames,
  QUESTION_TYPES,
} from "./ir.js";
import { fail, hasOwn, isFiniteNumber, isObject, isStrictBase64, pick } from "./util.js";

const S1_BASE_FIELDS = ["model", "state", "questions", "assets"];
// Members a dialect adds on top of System One. important ones change what the
// upstream does and are refused when the upstream cannot honor them;
// ignorable ones only label the request and are dropped elsewhere.
const S1_DIALECT_FIELDS = {
  typesafe: { important: [], ignorable: [] },
  openrouter: { important: ["provider"], ignorable: ["session_id", "trace", "user"] },
  scaledown: { important: [], ignorable: [] },
  compat: { important: ["mode", "max_staleness"], ignorable: ["user", "metadata"] },
};

// Instructions, Choice option descriptions and Noul outcomes may be null; the
// state and Score levels may not.
function s1IsEntry(value) {
  return value === null || typeof value === "string" || typeof value === "object";
}

function s1ValidateQuestion(id, question, allowOtherTypes) {
  const where = 'Question "' + id + '"';
  if (!isObject(question)) fail(where + " must be an object");
  const type = question.type;
  if (QUESTION_TYPES.indexOf(type) < 0) {
    if (allowOtherTypes && typeof type === "string" && type) return;
    fail(where + " must have type choice, score, noul, or box", "unsupported_question_type");
  }
  if (question.instructions !== undefined && !s1IsEntry(question.instructions))
    fail(where + " instructions must be text, an object, an array, or null");
  const criteria = question.criteria;
  if (type === "choice") {
    if (!isObject(criteria) || Object.keys(criteria).length === 0 || Object.keys(criteria).length > 255)
      fail(where + ": choice criteria must contain between 1 and 255 options");
    for (const key of Object.keys(criteria)) {
      if (!s1IsEntry(criteria[key])) fail(where + ": choice option descriptions must be text, objects, arrays, or null");
    }
  } else if (type === "score") {
    if (!Array.isArray(criteria) || criteria.length < 1 || criteria.length > 10)
      fail(where + ": score criteria must contain between 1 and 10 levels");
    for (const level of criteria) {
      if (level === null || !s1IsEntry(level)) fail(where + ": score levels must be text, objects, or arrays");
    }
  } else if (type === "noul" && criteria !== undefined && criteria !== null) {
    if (!isObject(criteria) || [criteria.true, criteria.false].some((value) => value !== undefined && !s1IsEntry(value)))
      fail(where + ": noul criteria must describe true and false with text, objects, arrays, or null");
  }
}

const S1_IMAGE_FORMATS = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };

function s1MimeFromFile(file) {
  const mime = String(file.mimeType || "").toLowerCase();
  if (mime === "image/png" || mime === "image/jpeg") return mime;
  if (mime === "image/jpg") return "image/jpeg";
  const name = String(file.filename || "").toLowerCase();
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  return "";
}

// assets -> {key: media segment}. Images are base64 in JSON or a multipart
// file part named by asset.part (the part wins when both are set).
function s1Assets(assets, files) {
  if (assets === undefined) return {};
  if (!isObject(assets) || Object.keys(assets).length === 0) fail("assets must be a nonempty object");
  const result = {};
  const usedParts = {};
  for (const key of Object.keys(assets)) {
    const asset = assets[key];
    const where = 'Asset "' + key + '"';
    if (!key.trim()) fail("Asset references cannot be empty");
    if (!isObject(asset)) fail(where + " must be an object");
    if (asset.type !== undefined && asset.type !== "image") fail(where + ' type must be "image"');
    if (typeof asset.part === "string" && asset.part) {
      const file = (files || []).find((item) => item.field === asset.part);
      if (!file) fail(where + ' names part "' + asset.part + '", which the request did not upload');
      if (usedParts[asset.part]) fail('Two assets name the same part "' + asset.part + '"');
      usedParts[asset.part] = true;
      const format = typeof asset.format === "string" ? asset.format.toLowerCase() : "";
      const mime = S1_IMAGE_FORMATS[format] || s1MimeFromFile(file);
      result[key] = { t: "media", kind: "image", mime: mime, fileRef: file.ref, filename: file.filename, size: file.size };
      continue;
    }
    const format = typeof asset.format === "string" ? asset.format : "";
    if (!S1_IMAGE_FORMATS[format]) fail(where + " needs format png, jpg, or jpeg with data_base64");
    if (!isStrictBase64(asset.data_base64)) fail(where + " data_base64 must be standard base64 without a data: prefix or whitespace");
    result[key] = { t: "media", kind: "image", mime: S1_IMAGE_FORMATS[format], data: asset.data_base64 };
  }
  for (const file of files || []) {
    if (!usedParts[file.field]) fail('The uploaded part "' + file.field + '" is not named by any asset');
  }
  return result;
}

function s1ReferencedAssets(body, assets) {
  const keys = Object.keys(assets);
  if (keys.length === 0) return;
  const seen = {};
  const visit = function (value) {
    if (typeof value === "string") {
      for (const key of keys) if (value.indexOf(key) >= 0) seen[key] = true;
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (isObject(value)) Object.keys(value).forEach((member) => visit(value[member]));
  };
  visit(body.state);
  for (const id of Object.keys(body.questions)) {
    visit(body.questions[id].instructions);
    visit(body.questions[id].criteria);
  }
  for (const key of keys) if (!seen[key]) fail('Asset "' + key + '" is not referenced in state, instructions, or criteria');
}

// ScaleDown takes the state as {text} or {document, document_mime_type}.
function s1ScaleDownState(state) {
  if (isObject(state) && typeof state.text === "string" && Object.keys(state).length === 1) return [{ t: "text", text: state.text }];
  if (isObject(state) && typeof state.document === "string") {
    if (!isStrictBase64(state.document)) fail("state.document must be standard base64");
    const mime = typeof state.document_mime_type === "string" && state.document_mime_type ? state.document_mime_type.toLowerCase() : "application/pdf";
    return [{ t: "media", kind: mime.startsWith("image/") ? "image" : "document", mime: mime, data: state.document }];
  }
  return null;
}

export function s1Decode(body, dialect, files) {
  if (!isObject(body)) fail("Request body must be a JSON object");
  const rules = S1_DIALECT_FIELDS[dialect] || S1_DIALECT_FIELDS.typesafe;
  const extras = { important: {}, ignorable: {} };
  for (const field of Object.keys(body)) {
    if (S1_BASE_FIELDS.indexOf(field) >= 0) continue;
    if (rules.important.indexOf(field) >= 0) extras.important[field] = body[field];
    else if (rules.ignorable.indexOf(field) >= 0) extras.ignorable[field] = body[field];
    else fail("System One does not accept the request field " + field, "unknown_field");
  }
  if (typeof body.model !== "string" || !body.model.trim()) fail("model is required");
  if (body.state === null || body.state === undefined || !s1IsEntry(body.state)) fail("state must be text, an object, or an array");
  if (!isObject(body.questions) || Object.keys(body.questions).length === 0) fail("questions must be a nonempty object");
  const allowOtherTypes = dialect === "compat";
  for (const id of Object.keys(body.questions)) s1ValidateQuestion(id, body.questions[id], allowOtherTypes);
  const assets = s1Assets(body.assets, files);
  s1ReferencedAssets(body, assets);

  const input = (dialect === "scaledown" && s1ScaleDownState(body.state)) || contentFromSystemOne(body.state, assets);
  const questions = Object.keys(body.questions).map(function (id) {
    const source = body.questions[id];
    const question = { name: id, named: true, type: source.type, instructions: contentFromSystemOne(source.instructions, assets), raw: source };
    if (source.type === "noul" && isObject(source.criteria)) {
      question.trueText = contentFromSystemOne(source.criteria.true, assets);
      question.falseText = contentFromSystemOne(source.criteria.false, assets);
    } else if (source.type === "choice") {
      question.options = Object.keys(source.criteria).map((key) => ({ key: key, value: key, description: contentFromSystemOne(source.criteria[key], assets) }));
    } else if (source.type === "score") {
      question.levels = source.criteria.map((level) => ({ description: contentFromSystemOne(level, assets), source: level }));
    }
    return question;
  });
  return {
    source: { family: "systemone", dialect: dialect },
    model: body.model,
    input: input,
    questions: questions,
    extras: extras,
    passthrough: dialect === "scaledown" ? null : body,
    hasAssets: Object.keys(assets).length > 0,
  };
}

// ---- upstream encoder -------------------------------------------------------

function s1Sink(newId) {
  const sink = {
    assets: {},
    multipart: false,
    files: [],
    add: function (segment, where) {
      if (segment.kind !== "image")
        fail(where + " contains " + segment.kind + " content; System One upstreams accept only PNG and JPEG images", "unsupported_modality");
      const format = segment.mime === "image/png" ? "png" : segment.mime === "image/jpeg" ? "jpeg" : "";
      if (segment.url) fail(where + " has an image URL; System One upstreams take images as base64 or uploaded files, not URLs", "unsupported_modality");
      if (segment.fileRef) {
        const key = newId();
        const part = "image_" + sink.files.length;
        sink.files.push({ name: part, fileRef: segment.fileRef, filename: segment.filename || part });
        sink.assets[key] = format ? { type: "image", format: format, part: part } : { type: "image", part: part };
        sink.multipart = true;
        return key;
      }
      if (!format) fail(where + " has a " + (segment.mime || "unknown") + " image; System One upstreams accept only PNG and JPEG", "unsupported_modality");
      const key = newId();
      sink.assets[key] = { type: "image", format: format, data_base64: segment.data };
      return key;
    },
  };
  return sink;
}

export function s1LevelValue(level) {
  if (level.source !== undefined) return level.source;
  if (level.label !== undefined) {
    const description = contentToText(level.description, "A score level");
    return description ? level.label + ": " + description : level.label;
  }
  return contentToText(level.description, "A score level");
}

function s1QuestionFromIR(question, sink, fill) {
  const where = 'Question "' + question.name + '"';
  const out = { type: question.type };
  const instructions = contentToSystemOne(question.instructions, sink, where);
  if (instructions !== null) out.instructions = instructions;
  else if (fill) out.instructions = question.name;
  if (question.type === "noul") {
    const yes = contentToSystemOne(question.trueText, sink, where);
    const no = contentToSystemOne(question.falseText, sink, where);
    if (yes !== null || no !== null) {
      out.criteria = {};
      if (yes !== null) out.criteria.true = yes;
      if (no !== null) out.criteria.false = no;
    }
  } else if (question.type === "choice") {
    out.criteria = {};
    for (const option of question.options) {
      if (hasOwn(out.criteria, option.key)) fail(where + ' has two options that both read "' + option.key + '" on System One');
      out.criteria[option.key] = contentToSystemOne(option.description, sink, where);
    }
    if (question.options.length > 255) fail(where + " has more than 255 options; System One accepts 1 to 255", "limit_exceeded");
  } else if (question.type === "score") {
    out.criteria = question.levels.map(s1LevelValue);
    if (out.criteria.length > 10) fail(where + " has more than 10 levels; System One accepts 1 to 10", "limit_exceeded");
  } else if (question.type !== "box") {
    fail(where + " has type " + question.type + ", which System One does not define", "unsupported_question_type");
  }
  return out;
}

// Some System One upstreams (Telnyx, Requesty, OpenCSG) require instructions
// on every question; System One shows the model the question's name, so that
// is what a missing instruction becomes when the channel asks for it.
function s1FillInstructions(questions) {
  const out = {};
  for (const name of Object.keys(questions)) {
    const question = questions[name];
    if (isObject(question) && (question.instructions === undefined || question.instructions === null)) {
      const filled = {};
      for (const key of Object.keys(question)) {
        filled[key] = question[key];
        if (key === "type") filled.instructions = name;
      }
      if (filled.instructions === undefined || filled.instructions === null) filled.instructions = name;
      out[name] = filled;
    } else out[name] = question;
  }
  return out;
}

// Returns {body, multipartFiles, images}.
export function s1Encode(ir, upstreamDialect, model, newId, options) {
  const fill = !!(options && options.fillInstructions);
  const allowed = S1_DIALECT_FIELDS[upstreamDialect] || S1_DIALECT_FIELDS.typesafe;
  // A Databricks body is System One's state and questions, so it goes as written too.
  const sameFamily = (ir.source.family === "systemone" || ir.source.family === "databricks") && ir.passthrough;
  const body = { model: model };
  let multipart = null;
  let images = false;
  if (sameFamily) {
    const pass = ir.passthrough;
    body.state = pass.state;
    body.questions = fill ? s1FillInstructions(pass.questions) : pass.questions;
    if (pass.assets !== undefined) body.assets = pass.assets;
    images = pass.assets !== undefined;
  } else {
    if (ir.onlyHere && ir.onlyHere.length) fail("The request has " + ir.onlyHere[0] + ", which System One cannot express", "unsupported_content");
    requireUniqueNames(ir.questions);
    const sink = s1Sink(newId);
    body.state = contentToSystemOne(ir.input, sink, "The input");
    if (body.state === null) body.state = "";
    body.questions = {};
    for (const question of ir.questions) body.questions[question.name] = s1QuestionFromIR(question, sink, fill);
    if (Object.keys(sink.assets).length > 0) body.assets = sink.assets;
    images = Object.keys(sink.assets).length > 0;
    if (sink.multipart) multipart = sink.files;
  }
  // A System One-shaped /v1/decisions client (Perplexity, Inception) talks to
  // a vendor of its own family: its extensions go through for that vendor to check.
  const forwardAll = sameFamily && ir.source.dialect === "compat";
  for (const kind of ["important", "ignorable"]) {
    for (const field of Object.keys(ir.extras[kind] || {})) {
      if (forwardAll || allowed.important.indexOf(field) >= 0 || allowed.ignorable.indexOf(field) >= 0) body[field] = ir.extras[kind][field];
      else if (kind === "important") fail("The request field " + field + " has no equivalent on the upstream protocol", "unsupported_field");
    }
  }
  if (ir.questions.some((question) => question.type === "box")) images = true;
  return { body: body, multipartFiles: multipart, images: images };
}

// ---- upstream reply ---------------------------------------------------------

function s1ProbabilityMap(value, where) {
  if (value === undefined || value === null) return undefined;
  if (!isObject(value)) fail(where + " probabilities must be an object", "upstream_invalid", 502);
  const result = {};
  for (const key of Object.keys(value)) {
    if (!isFiniteNumber(value[key])) fail(where + " has a non-numeric probability", "upstream_invalid", 502);
    result[key] = value[key];
  }
  return result;
}

function s1Confidence(value) {
  return isFiniteNumber(value) ? value : value === null ? null : undefined;
}

export function s1ParseAnswer(answer, question, where) {
  if (!isObject(answer)) fail(where + " is missing", "upstream_invalid", 502);
  if (answer.type === "refusal") return { type: "refusal", raw: answer };
  if (answer.type !== question.type) fail(where + " has type " + answer.type + " for a " + question.type + " question", "upstream_invalid", 502);
  if (answer.type === "noul") {
    if (!isFiniteNumber(answer.noul)) fail(where + " has no probability", "upstream_invalid", 502);
    return { type: "noul", probability: answer.noul, confidence: s1Confidence(answer.confidence), raw: answer };
  }
  if (answer.type === "choice") {
    const probabilities = s1ProbabilityMap(answer.probabilities, where);
    if (typeof answer.choice !== "string" || !question.options.some((option) => option.key === answer.choice))
      fail(where + " chose an option the question does not have", "upstream_invalid", 502);
    return { type: "choice", choice: answer.choice, probabilities: probabilities, confidence: s1Confidence(answer.confidence), raw: answer };
  }
  if (answer.type === "score") {
    if (!isFiniteNumber(answer.score)) fail(where + " has no score", "upstream_invalid", 502);
    const map = s1ProbabilityMap(answer.probabilities, where);
    let levels;
    if (map) levels = question.levels.map((level, index) => (hasOwn(map, String(index)) ? map[String(index)] : null));
    return { type: "score", score: answer.score, probabilities: levels, confidence: s1Confidence(answer.confidence), raw: answer };
  }
  if (answer.type === "box") {
    const box = answer.box;
    if (!isObject(box) || !["top", "bottom", "left", "right"].every((edge) => isFiniteNumber(box[edge])))
      fail(where + " has no box coordinates", "upstream_invalid", 502);
    return { type: "box", box: pick(box, ["top", "bottom", "left", "right"]), confidence: s1Confidence(answer.confidence), raw: answer };
  }
  return { type: "other", raw: answer };
}

function s1Integer(value) {
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

export function s1ParseUsage(usage) {
  if (!isObject(usage)) return null;
  const input = s1Integer(usage.input_tokens);
  if (input === undefined) return null;
  const details = isObject(usage.input_tokens_details) ? usage.input_tokens_details : {};
  const cached = s1Integer(details.cached_tokens) || s1Integer(usage.cached_input_tokens) || 0;
  const output = s1Integer(usage.output_tokens) || 0;
  return { input: input, cacheRead: Math.min(cached, input), cacheWrite: 0, output: output, reasoning: 0, total: input + output };
}

export function s1Parse(body, ir) {
  if (!isObject(body) || !isObject(body.answers)) fail("The upstream reply has no answers object", "upstream_invalid", 502);
  const answers = ir.questions.map(function (question) {
    const where = 'The answer to "' + question.name + '"';
    return s1ParseAnswer(hasOwn(body.answers, question.name) ? body.answers[question.name] : null, question, where);
  });
  return { model: typeof body.model === "string" ? body.model : "", answers: answers, usage: s1ParseUsage(body.usage) };
}

// ---- client renderer --------------------------------------------------------

export function s1RenderAnswer(answer, question, dialect) {
  if (answer.type === "refusal") return { type: "refusal" };
  if (answer.type === "other") return answer.raw;
  if (answer.type === "noul") {
    const out = { type: "noul", noul: answer.probability };
    if (dialect === "openrouter" && answer.confidence !== undefined) out.confidence = answer.confidence;
    return out;
  }
  if (answer.type === "choice") {
    const probabilities = {};
    if (answer.probabilities) {
      for (const option of question.options) if (hasOwn(answer.probabilities, option.key)) probabilities[option.key] = answer.probabilities[option.key];
    }
    return { type: "choice", choice: answer.choice, confidence: answer.confidence === undefined ? null : answer.confidence, probabilities: answer.probabilities ? probabilities : null };
  }
  if (answer.type === "score") {
    const legend = {};
    const probabilities = {};
    question.levels.forEach(function (level, index) {
      legend[String(index)] = level.source !== undefined ? level.source : level.label !== undefined ? level.label : contentToText(level.description, "A score level");
      if (answer.probabilities && answer.probabilities[index] !== null && answer.probabilities[index] !== undefined) probabilities[String(index)] = answer.probabilities[index];
    });
    return {
      type: "score",
      score: answer.score,
      confidence: answer.confidence === undefined ? null : answer.confidence,
      legend: legend,
      probabilities: answer.probabilities ? probabilities : null,
    };
  }
  return { type: "box", box: answer.box, confidence: answer.confidence === undefined ? null : answer.confidence };
}

export function s1RenderUsage(usage, dialect) {
  const out = { input_tokens: usage ? usage.input : 0, output_tokens: usage ? usage.output : 0 };
  if (dialect === "openrouter" && usage && usage.cacheRead) out.input_tokens_details = { cached_tokens: usage.cacheRead };
  return out;
}

export function s1Render(ir, result, dialect, taskId) {
  const answers = {};
  ir.questions.forEach(function (question, index) {
    answers[question.name] = s1RenderAnswer(result.answers[index], question, dialect);
  });
  const body = {};
  if (dialect === "openrouter") body.id = taskId;
  body.model = result.model || ir.model;
  body.answers = answers;
  body.usage = s1RenderUsage(result.usage, dialect);
  return body;
}

export function s1RenderError(status, message, code, upstream, dialect) {
  if (dialect === "openrouter") {
    if (isObject(upstream) && isObject(upstream.error) && typeof upstream.error.message === "string") return { error: { code: status, message: upstream.error.message } };
    return { error: { code: status, message: message } };
  }
  if (isObject(upstream) && upstream.detail !== undefined) return upstream;
  if (code && code !== "invalid_request") return { detail: { error_type: code, message: message } };
  return { detail: message };
}
