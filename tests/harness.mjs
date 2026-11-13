// Runs the built plugin.js the way New API does for a native submit route:
// decode -> extractUsage (reserve) -> buildSubmitRequest -> upstream ->
// parseSubmitResponse -> presenter -> extractUsageOnComplete (settle).
import assert from "node:assert/strict";
import { handle } from "./mock-upstream.mjs";

let counter = 0;
globalThis.utils = {
  uuid: () => "00000000-0000-4000-8000-" + String(++counter).padStart(12, "0"),
};

export const plugin = await import("../plugin.js");

export function routeFor(path) {
  const clean = path.startsWith("/decision/") ? path.slice("/decision".length) : path;
  const route = plugin.meta.routes.find((item) => item.path === clean);
  assert.ok(route, "no route " + path);
  return route;
}

// The mapping walk New API applies (alias -> tail).
function mapModel(model, mapping) {
  let current = model;
  const seen = new Set([current]);
  while (mapping && mapping[current] && !seen.has(mapping[current])) {
    current = mapping[current];
    seen.add(current);
  }
  return current;
}

export function decode(path, body, options = {}) {
  const route = routeFor(path);
  const ctxBody = options.multipart ? { kind: "multipart", fields: { request: [JSON.stringify(body)] }, files: options.files || [] } : { kind: "json", value: body };
  return plugin.native[route.decode]({ method: "POST", path, params: {}, query: {}, requestHeaders: options.headers || {}, body: ctxBody });
}

export function driverContext(intent, options = {}) {
  return {
    requestBody: intent.requestBody,
    requestHeaders: Object.assign({ "Content-Type": "application/json", Accept: "" }, options.headers || {}),
    action: intent.action,
    model: intent.model,
    upstreamModel: mapModel(intent.model, options.mapping),
    baseUrl: options.baseUrl || "https://upstream.example",
    apiKey: "sk-upstream-secret",
    authHeader: "Bearer sk-upstream-secret",
    upstream: { kind: options.gateway ? "new_api" : "vendor" },
    config: Object.assign({ protocol: "systemone", path: "", authType: "auto", authHeader: "", maxQuestions: 0, reserveTokens: 0 }, options.config || {}),
    files: options.files || [],
    publicTaskId: "task_test_1",
  };
}

// Sends a descriptor to the in-process mock. Multipart descriptors are
// reduced to the JSON of their request part.
export function send(request) {
  const url = new URL(request.url);
  let body = request.body;
  if (request.bodyType === "multipart") body = JSON.parse(request.parts.find((part) => part.name === "request").value);
  return handle(url.pathname + url.search, request.headers, body);
}

export function run(path, body, options = {}) {
  const intent = decode(path, body, options);
  assert.equal(intent.kind, "submit");
  const ctx = driverContext(intent, options);
  const reserved = plugin.extractUsage(ctx);
  const request = plugin.buildSubmitRequest(ctx);
  const upstream = (options.upstream || send)(request);
  if (upstream.status < 200 || upstream.status >= 300) {
    const error = plugin.native.error({ method: "POST", path, params: {}, query: {}, requestHeaders: {}, body: { kind: "json", value: body } }, { code: "fail_to_fetch_task", message: JSON.stringify(upstream.body), httpStatus: upstream.status, retryable: false, requestId: "r" });
    return { intent, ctx, reserved, request, upstream, error };
  }
  const parsed = plugin.parseSubmitResponse(ctx, { statusCode: upstream.status, headers: {}, body: upstream.body });
  const reply = plugin.native.renderDecision({ path, body: { kind: "json", value: body } }, { task_id: parsed.taskId, status: "SUCCESS", data: parsed.taskData });
  let settled;
  let settleError;
  try {
    settled = plugin.extractUsageOnComplete({ model: ctx.model, upstreamModel: ctx.upstreamModel, config: ctx.config }, parsed.immediate, parsed.taskData);
  } catch (error) {
    settleError = error;
  }
  return { intent, ctx, reserved, request, upstream, parsed, reply, settled, settleError };
}

// The error presenter's reply for a hook failure.
export function presentError(path, body, thrown) {
  return plugin.native.error({ method: "POST", path, params: {}, query: {}, requestHeaders: {}, body: { kind: "json", value: body } }, { code: "plugin_error", message: thrown.message, httpStatus: 400, retryable: false, requestId: "r" });
}

export function failure(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail("expected an error");
}
