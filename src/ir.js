// Decision IR: the protocol-neutral form every decoder produces and every
// encoder consumes.
//
// Request IR
//   {source, model, input, questions, extras, files, passthrough}
//   source      {protocol, dialect} the client protocol
//   input       Content: the shared input (System One state, OpenAI input,
//               Gemini input, AI SDK state)
//   questions   Question[] in the client's order
//   extras      protocol members with no cross-protocol meaning, by kind:
//               {ignorable: {name: value}, important: {name: value}}
//   passthrough the client body as sent, for an upstream of the same family
//
// Content is Segment[] or null:
//   {t: "text", text}
//   {t: "json", value, refs}        refs: JSON holds System One image references
//   {t: "media", kind, mime, data?, url?, fileRef?, filename?, size?, detail?, extra?}
//                                   kind: image | audio | video | document
//
// Question
//   {name, named, type, instructions: Content, trueText: Content, falseText: Content,
//    options: [{key, value, description: Content}],      choice
//    levels: [{label, description: Content, source}],    score
//    rawCriteria}                                        criteria as the client wrote them
//   type: noul | choice | score | box, or another vendor type kept for
//   same-family passthrough only.
//
// Answer IR (upstream reply)
//   {type: noul|choice|score|box|refusal|other, probability, choice (option key),
//    probabilities: {key: p} (choice) | number[] (score, by level), confidence,
//    score, box: {top, bottom, left, right}, raw}
// Usage IR
//   {input, cacheRead, cacheWrite, output, reasoning, total}; input includes the
//   cached and cache-write tokens, as OpenAI reports it.

import { DecisionError, fail, forEachString, isObject } from "./util.js";

export const QUESTION_TYPES = ["noul", "choice", "score", "box"];

export function textSegment(text) {
  return { t: "text", text: text };
}

// Split a System One string on its image references, left to right without
// overlap; a string that is exactly one reference becomes that image.
export function splitReferences(text, assets) {
  const keys = assets ? Object.keys(assets) : [];
  if (keys.length === 0) return [textSegment(text)];
  const segments = [];
  let buffer = "";
  let index = 0;
  while (index < text.length) {
    let matched = null;
    for (const key of keys) {
      if (key && text.startsWith(key, index) && (!matched || key.length > matched.length)) matched = key;
    }
    if (matched) {
      if (buffer) segments.push(textSegment(buffer));
      buffer = "";
      segments.push(assets[matched]);
      index += matched.length;
    } else {
      buffer += text[index];
      index++;
    }
  }
  if (buffer || segments.length === 0) segments.push(textSegment(buffer));
  return segments;
}

export function jsonHasReference(value, assets) {
  const keys = assets ? Object.keys(assets) : [];
  if (keys.length === 0) return false;
  let found = false;
  forEachString(value, function (text) {
    if (!found && keys.some((key) => text.indexOf(key) >= 0)) found = true;
  });
  return found;
}

// A System One value (state, instructions, criteria entry) as Content.
export function contentFromSystemOne(value, assets) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return splitReferences(value, assets);
  if (Array.isArray(value)) {
    const segments = [];
    for (const item of value) {
      if (typeof item === "string") segments.push.apply(segments, splitReferences(item, assets));
      else segments.push({ t: "json", value: item, refs: jsonHasReference(item, assets) });
    }
    return segments;
  }
  return [{ t: "json", value: value, refs: jsonHasReference(value, assets) }];
}

function ensureNoReferences(segments, where) {
  for (const segment of segments) {
    if (segment.t === "json" && segment.refs)
      fail(where + " puts an image reference inside a JSON object, which the upstream protocol cannot express; put the image reference in a string of its own", "unsupported_content");
  }
}

// Content as plain text, for targets whose field takes only a string. JSON is
// written as its JSON text; images are not allowed there.
export function contentToText(content, where) {
  if (!content || content.length === 0) return "";
  ensureNoReferences(content, where);
  let text = "";
  for (const segment of content) {
    if (segment.t === "text") text += segment.text;
    else if (segment.t === "json") text += JSON.stringify(segment.value);
    else fail(where + " contains " + segment.kind + " content, which the upstream protocol accepts only in the shared input", "unsupported_content");
  }
  return text;
}

// Names for questions the client left unnamed (OpenAI names are optional),
// unique against the names it did give.
export function assignQuestionNames(questions) {
  const used = {};
  for (const question of questions) if (question.named) used[question.name] = true;
  let counter = 0;
  for (const question of questions) {
    if (question.named) continue;
    let name;
    do {
      name = "question_" + counter++;
    } while (used[name]);
    used[name] = true;
    question.name = name;
  }
}

export function requireUniqueNames(questions) {
  const seen = {};
  for (const question of questions) {
    if (seen[question.name]) fail('Two questions share the name "' + question.name + '"', "invalid_request");
    seen[question.name] = true;
  }
}

// Writes Content back as a System One value. Images become references into
// sink.assets, with a fresh id per image as TypeSafe recommends.
export function contentToSystemOne(content, sink, where) {
  if (!content || content.length === 0) return null;
  const items = content.map(function (segment) {
    if (segment.t === "text") return segment.text;
    if (segment.t === "json") return segment.value;
    return sink.add(segment, where);
  });
  if (items.length === 1) return items[0];
  // Adjacent strings stay separate array items; System One reads an array of
  // text values in order.
  return items;
}

export function toDecisionError(error) {
  if (error instanceof DecisionError) return error;
  return new DecisionError(error && error.message ? error.message : String(error), 400, "invalid_request");
}

export function isObjectContent(content) {
  return !!content && content.length === 1 && content[0].t === "json" && isObject(content[0].value);
}
