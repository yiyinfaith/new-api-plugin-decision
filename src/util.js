// Shared helpers. Every module is bundled into one plugin.js by build.mjs, so
// top-level names must be unique across src/.

export function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

// A lookup table's own entry: a client value such as "constructor" never
// reaches an inherited member.
export function own(table, key) {
  return typeof key === "string" && hasOwn(table, key) ? table[key] : undefined;
}

// A client JSON value that holds a __proto__ member: written into a plain
// object, it would replace the prototype instead of adding the member.
export function hasProtoKey(value) {
  if (Array.isArray(value)) return value.some(hasProtoKey);
  if (!isObject(value)) return false;
  if (hasOwn(value, "__proto__")) return true;
  return Object.keys(value).some((key) => hasProtoKey(value[key]));
}

// A client-facing failure. status is the HTTP status the gateway should use,
// code a short machine-readable reason shown in the client's error format.
export class DecisionError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status || 400;
    this.code = code || "invalid_request";
  }
}

export function fail(message, code, status) {
  throw new DecisionError(message, status || 400, code || "invalid_request");
}

// UTF-8 byte length without TextEncoder (not every plugin runtime has it).
export function utf8Length(text) {
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      index++;
    } else bytes += 3;
  }
  return bytes;
}

export function headerValue(headers, name) {
  if (!isObject(headers)) return undefined;
  const wanted = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === wanted) return headers[key];
  }
  return undefined;
}

export function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// Standard base64 with padding, no whitespace and no data: prefix.
export function isStrictBase64(value) {
  return typeof value === "string" && value.length > 0 && value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

export function base64Bytes(value) {
  if (typeof value !== "string") return 0;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((value.length * 3) / 4) - padding);
}

// data:<mime>;base64,<data> -> {mime, data}; null for anything else.
export function parseDataUrl(value) {
  if (typeof value !== "string" || !value.startsWith("data:")) return null;
  const comma = value.indexOf(",");
  if (comma < 0) return null;
  const header = value.slice(5, comma);
  const parts = header.split(";");
  if (parts.indexOf("base64") < 0) return null;
  const mime = parts[0].trim().toLowerCase();
  const data = value.slice(comma + 1);
  if (!mime || !isStrictBase64(data)) return null;
  return { mime: mime, data: data };
}

export function isHttpUrl(value) {
  return typeof value === "string" && /^https?:\/\/[^\s]+$/i.test(value);
}

// Every string inside a JSON value, depth first.
export function forEachString(value, visit) {
  if (typeof value === "string") {
    visit(value);
  } else if (Array.isArray(value)) {
    for (const item of value) forEachString(item, visit);
  } else if (isObject(value)) {
    for (const key of Object.keys(value)) forEachString(value[key], visit);
  }
}

// Shallow copy of an object with the given members in order, skipping undefined.
export function pick(source, keys) {
  const result = {};
  for (const key of keys) {
    if (source[key] !== undefined) result[key] = source[key];
  }
  return result;
}

// A USD amount a relay reports for a request: a finite, non-negative number.
export function reportedCost(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
