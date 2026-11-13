// Compares the declared models with the live decision model catalogs and
// reports the differences. It never edits src/models.js: a new ID is added by
// hand after checking the vendor's documentation.
//
//   node scripts/sync-models.mjs           report only
//   node scripts/sync-models.mjs --strict  exit 1 when a catalog has an undeclared model
//
// Catalogs (public, no key):
//   OpenRouter  GET /api/v1/models?output_modalities=decisions, and the models
//               on /api/alpha/extractions
//   Vercel AI Gateway  GET https://ai-gateway.vercel.sh/v1/models, type "evaluation"
//   SubQ        GET https://api.subq.ai/v1/models
import { appendFileSync } from "node:fs";

globalThis.utils = globalThis.utils || { uuid: () => "" };
const { meta } = await import(new URL("../plugin.js", import.meta.url));

// Catalog entries that are not decision or extraction models served by this
// plugin, with the reason.
const IGNORED = {};

async function json(url) {
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "decision-model-sync" }, signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(url + " answered HTTP " + response.status);
  return response.json();
}

const CATALOGS = [
  {
    name: "OpenRouter",
    load: async () => {
      const all = (await json("https://openrouter.ai/api/v1/models?output_modalities=all")).data || [];
      return all.filter((model) => (model.endpoints || []).some((endpoint) => endpoint === "/api/alpha/decisions" || endpoint === "/api/alpha/extractions")).map((model) => model.id);
    },
  },
  {
    name: "Vercel AI Gateway",
    load: async () => ((await json("https://ai-gateway.vercel.sh/v1/models")).data || []).filter((model) => model.type === "evaluation").map((model) => model.id),
  },
  { name: "SubQ", load: async () => ((await json("https://api.subq.ai/v1/models")).data || []).map((model) => model.id) },
];

const declared = new Set(meta.models.map((model) => model.toLowerCase()));
const strict = process.argv.includes("--strict");
const lines = ["## Decision model catalogs", ""];
let undeclared = 0;
let failures = 0;
const seen = new Set();

for (const catalog of CATALOGS) {
  let ids;
  try {
    ids = await catalog.load();
  } catch (error) {
    failures++;
    lines.push("- " + catalog.name + ": could not be read (" + error.message + ")");
    continue;
  }
  ids.forEach((id) => seen.add(id.toLowerCase()));
  const missing = ids.filter((id) => !declared.has(id.toLowerCase()) && !IGNORED[id]).sort();
  undeclared += missing.length;
  lines.push("- " + catalog.name + ": " + ids.length + " models, " + (missing.length ? missing.length + " not declared: " + missing.map((id) => "`" + id + "`").join(", ") : "all declared"));
}

// Declared IDs under a catalog's own naming (vendor/model) that no catalog
// lists any more: possibly retired, never removed automatically.
const gatewayNamed = meta.models.filter((model) => model.includes("/") && !model.startsWith("decision-models/") && !model.startsWith("accounts/") && !model.startsWith("system."));
const gone = gatewayNamed.filter((model) => !seen.has(model.toLowerCase()));
lines.push("- Declared gateway IDs not in any catalog (check before acting; vendor-native and LiteLLM names are expected here): " + (gone.length ? gone.map((id) => "`" + id + "`").join(", ") : "none"));

const report = lines.join("\n") + "\n";
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
if (strict && (undeclared > 0 || failures === CATALOGS.length)) process.exit(1);
