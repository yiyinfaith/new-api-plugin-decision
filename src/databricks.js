// Databricks AI Functions ai-decide (POST /api/2.0/ai-functions/ai-decide, Beta;
// https://docs.databricks.com/api/ai-functions/v1/ai-decide).
//
// The body is System One's state and questions without a model: noul, choice
// and score questions, instructions on every question, 2 to 10 score levels,
// no images. The reply wraps the answers in response.answers, a noul answer
// carries probability instead of noul, and no token usage is reported.
// Clients send a model as well, for New API routing; the upstream request
// never carries one.

import { contentFromSystemOne, contentToSystemOne, requireUniqueNames } from "./ir.js";
import { s1LevelValue, s1ParseAnswer, s1RenderAnswer } from "./systemone.js";
import { fail, hasOwn, isFiniteNumber, isObject } from "./util.js";

const DB_FIELDS = ["model", "state", "questions", "options"];
const DB_QUESTION_FIELDS = ["type", "instructions", "criteria"];
const DB_TYPES = ["noul", "choice", "score"];
export const DB_VERSION = "1.0";

// Descriptions may be text, an object or an array.
function dbIsValue(value) {
  return typeof value === "string" || (value !== null && typeof value === "object");
}

function dbBlank(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return !value.trim();
  if (Array.isArray(value)) return value.length === 0;
  return isObject(value) && Object.keys(value).length === 0;
}

function dbValidateQuestion(id, question) {
  const where = 'Question "' + id + '"';
  if (!id.trim()) fail("Question names must contain text");
  if (!isObject(question)) fail(where + " must be an object");
  for (const member of Object.keys(question)) {
    if (DB_QUESTION_FIELDS.indexOf(member) < 0) fail(where + " does not accept the member " + member, "unknown_field");
  }
  if (DB_TYPES.indexOf(question.type) < 0) fail(where + " must have type noul, choice, or score", "unsupported_question_type");
  if (!dbIsValue(question.instructions)) fail(where + " needs instructions as text, an object, or an array");
  const criteria = question.criteria;
  if (question.type === "choice") {
    if (!isObject(criteria) || Object.keys(criteria).length === 0 || Object.keys(criteria).length > 255)
      fail(where + ": choice criteria must contain between 1 and 255 options");
    for (const key of Object.keys(criteria)) {
      if (!key.trim()) fail(where + ": choice option names must contain text");
      if (criteria[key] !== null && !dbIsValue(criteria[key])) fail(where + ": choice option descriptions must be text, objects, arrays, or null");
    }
  } else if (question.type === "score") {
    if (!Array.isArray(criteria) || criteria.length < 2 || criteria.length > 10) fail(where + ": score criteria must contain between 2 and 10 levels");
    for (const level of criteria) {
      if (!dbIsValue(level) || dbBlank(level)) fail(where + ": score levels must be nonblank text, objects, or arrays");
    }
  } else if (criteria !== undefined) {
    if (!isObject(criteria)) fail(where + ": noul criteria must be an object with true and false descriptions");
    for (const key of Object.keys(criteria)) {
      if (key !== "true" && key !== "false") fail(where + ": noul criteria accept only true and false", "unknown_field");
      if (!dbIsValue(criteria[key])) fail(where + ": noul criteria descriptions must be text, objects, or arrays");
    }
    if (dbBlank(question.instructions) && dbBlank(criteria.true) && dbBlank(criteria.false)) fail(where + " needs instructions or a criteria description");
  } else if (dbBlank(question.instructions)) fail(where + " needs instructions or a criteria description");
}

export function dbDecode(body) {
  if (!isObject(body)) fail("Request body must be a JSON object");
  for (const field of Object.keys(body)) {
    if (DB_FIELDS.indexOf(field) < 0) fail("Databricks ai-decide does not accept the request field " + field, "unknown_field");
  }
  if (typeof body.model !== "string" || !body.model.trim()) fail("model is required: the gateway routes the request by it");
  if (!dbIsValue(body.state)) fail("state must be text, an object, or an array");
  if (!isObject(body.questions) || Object.keys(body.questions).length === 0) fail("questions must be a nonempty object");
  for (const id of Object.keys(body.questions)) dbValidateQuestion(id, body.questions[id]);
  const extras = { important: {}, ignorable: {} };
  if (body.options !== undefined) {
    if (!isObject(body.options)) fail("options must be an object");
    for (const key of Object.keys(body.options)) if (key !== "version") fail("options does not accept the member " + key, "unknown_field");
    if (body.options.version !== undefined && body.options.version !== DB_VERSION) fail('options.version must be "' + DB_VERSION + '"');
    // Version 1.0 is the only one; other protocols have nothing to set.
    extras.ignorable.options = body.options;
  }
  const questions = Object.keys(body.questions).map(function (id) {
    const source = body.questions[id];
    const question = { name: id, named: true, type: source.type, instructions: contentFromSystemOne(source.instructions, {}), raw: source };
    if (source.type === "noul" && isObject(source.criteria)) {
      question.trueText = contentFromSystemOne(source.criteria.true, {});
      question.falseText = contentFromSystemOne(source.criteria.false, {});
    } else if (source.type === "choice") {
      question.options = Object.keys(source.criteria).map((key) => ({ key: key, value: key, description: contentFromSystemOne(source.criteria[key], {}) }));
    } else if (source.type === "score") {
      question.levels = source.criteria.map((level) => ({ description: contentFromSystemOne(level, {}), source: level }));
    }
    return question;
  });
  return {
    source: { family: "databricks", dialect: "databricks" },
    model: body.model,
    input: contentFromSystemOne(body.state, {}),
    questions: questions,
    extras: extras,
    passthrough: body,
    hasAssets: false,
  };
}

// ---- upstream encoder -------------------------------------------------------

const NO_MEDIA = {
  add: function (segment, where) {
    fail(where + " contains " + segment.kind + " content; Databricks ai-decide accepts text and JSON only", "unsupported_modality");
  },
};

function dbValue(content, where) {
  return contentToSystemOne(content, NO_MEDIA, where);
}

// A System One or Databricks client's own values go upstream as written; any
// other client's are converted from the IR.
function dbQuestion(question, raw) {
  const where = 'Question "' + question.name + '"';
  const source = raw ? question.raw : null;
  if (DB_TYPES.indexOf(question.type) < 0) fail(where + " has type " + question.type + "; Databricks ai-decide supports noul, choice, and score", "unsupported_question_type");
  const out = { type: question.type };
  const instructions = source ? source.instructions : dbValue(question.instructions, where);
  // Databricks requires instructions on every question; System One shows the
  // model the question's name, so that is what a missing one becomes.
  out.instructions = instructions === undefined || instructions === null ? question.name : instructions;
  if (question.type === "noul") {
    const criteria = {};
    const yes = source ? (isObject(source.criteria) ? source.criteria.true : null) : dbValue(question.trueText, where);
    const no = source ? (isObject(source.criteria) ? source.criteria.false : null) : dbValue(question.falseText, where);
    if (yes !== null && yes !== undefined) criteria.true = yes;
    if (no !== null && no !== undefined) criteria.false = no;
    if (Object.keys(criteria).length) out.criteria = criteria;
  } else if (question.type === "choice") {
    out.criteria = {};
    for (const option of question.options) {
      if (hasOwn(out.criteria, option.key)) fail(where + ' has two options that both read "' + option.key + '" on Databricks');
      out.criteria[option.key] = source ? source.criteria[option.key] : dbValue(option.description, where);
    }
    if (question.options.length > 255) fail(where + " has more than 255 options; Databricks accepts 1 to 255", "limit_exceeded");
  } else {
    out.criteria = question.levels.map(s1LevelValue);
    if (out.criteria.length < 2 || out.criteria.length > 10) fail(where + " has " + out.criteria.length + " levels; Databricks accepts 2 to 10", "limit_exceeded");
    if (out.criteria.some(dbBlank)) fail(where + " has a blank level; Databricks needs a description for every level");
  }
  return out;
}

// keepModel: the upstream is another New API, whose gateway routes by model.
export function dbEncode(ir, model, keepModel) {
  if (ir.onlyHere && ir.onlyHere.length) fail("The request has " + ir.onlyHere[0] + ", which Databricks ai-decide cannot express", "unsupported_content");
  requireUniqueNames(ir.questions);
  const raw = (ir.source.family === "systemone" || ir.source.family === "databricks") && !!ir.passthrough && !ir.hasAssets;
  const body = {};
  if (keepModel) body.model = model;
  let state = raw ? ir.passthrough.state : dbValue(ir.input, "The input");
  if (state === null || state === undefined) state = "";
  body.state = state;
  body.questions = {};
  for (const question of ir.questions) body.questions[question.name] = dbQuestion(question, raw);
  for (const kind of ["important", "ignorable"]) {
    for (const field of Object.keys(ir.extras[kind] || {})) {
      if (field === "options" && ir.source.family === "databricks") body.options = ir.extras[kind][field];
      else if (kind === "important") fail("The request field " + field + " has no equivalent on Databricks ai-decide", "unsupported_field");
    }
  }
  return { body: body };
}

// ---- upstream reply ---------------------------------------------------------

export function dbParse(body, ir) {
  const response = isObject(body) && isObject(body.response) ? body.response : null;
  if (!response || !isObject(response.answers)) fail("The upstream reply has no response.answers object", "upstream_invalid", 502);
  const answers = ir.questions.map(function (question) {
    const where = 'The answer to "' + question.name + '"';
    const answer = hasOwn(response.answers, question.name) ? response.answers[question.name] : null;
    if (isObject(answer) && answer.type === "noul" && question.type === "noul") {
      if (!isFiniteNumber(answer.probability)) fail(where + " has no probability", "upstream_invalid", 502);
      return { type: "noul", probability: answer.probability, raw: answer };
    }
    return s1ParseAnswer(answer, question, where);
  });
  // ai-decide reports no model and no token usage.
  return { model: "", answers: answers, usage: null };
}

// ---- client renderer --------------------------------------------------------

export function dbRender(ir, result) {
  const answers = {};
  ir.questions.forEach(function (question, index) {
    const answer = result.answers[index];
    answers[question.name] = answer.type === "noul" ? { type: "noul", probability: answer.probability } : s1RenderAnswer(answer, question, "typesafe");
  });
  return { response: { answers: answers }, metadata: { version: DB_VERSION } };
}

// https://docs.databricks.com/api/workspace/errors
const DB_ERROR_CODES = {
  400: "INVALID_PARAMETER_VALUE",
  401: "UNAUTHENTICATED",
  403: "PERMISSION_DENIED",
  404: "NOT_FOUND",
  409: "ABORTED",
  429: "RESOURCE_EXHAUSTED",
  500: "INTERNAL_ERROR",
  503: "TEMPORARILY_UNAVAILABLE",
  504: "DEADLINE_EXCEEDED",
};

export function dbRenderError(status, message, code, upstream) {
  if (isObject(upstream) && typeof upstream.error_code === "string" && typeof upstream.message === "string") return upstream;
  return { error_code: DB_ERROR_CODES[status] || (status >= 500 ? "INTERNAL_ERROR" : "BAD_REQUEST"), message: message };
}
