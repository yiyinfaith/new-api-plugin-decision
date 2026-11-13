// Release consistency: one version everywhere, and marketplace files that
// follow the plugin API's README and CHANGELOG rules.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const problems = [];
const expect = (condition, message) => condition || problems.push(message);

const version = /const VERSION = "([^"]+)"/.exec(read("src/plugin.js"))[1];
expect(JSON.parse(read("package.json")).version === version, "package.json version differs from src/plugin.js");
expect(read("CHANGELOG.md").includes(`## ${version}`), "CHANGELOG.md has no entry for " + version);
expect(read("API.md").includes(`版本 **${version}**`), "API.md names another version");
expect(read("README.md").includes(`v${version}`), "README.md names another version");

const ORDER = ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security", "Migration"];
for (const file of ["marketplace/CHANGELOG.md", "marketplace/CHANGELOG.zh-CN.md"]) {
  const text = read(file);
  expect(text.startsWith("---\n"), file + " must start with front matter");
  expect(text.includes(`version: "${version}"`) && text.includes('plugin: "decision"'), file + " metadata must name decision " + version);
  expect(text.includes(`## [${version}]`) && (text.match(/^# Changelog$/gm) || []).length === 1, file + " needs one # Changelog and ## [" + version + "]");
  const categories = [...text.matchAll(/^### (.+)$/gm)].map((match) => match[1]);
  const ordered = categories.every((name, index) => ORDER.includes(name) && (index === 0 || ORDER.indexOf(name) > ORDER.indexOf(categories[index - 1])));
  expect(ordered, file + " categories must be standard and in order");
}
for (const file of ["marketplace/README.md", "marketplace/README.zh-CN.md"]) {
  const body = read(file).replace(/^---\n[\s\S]*?\n---\n/, "");
  const prose = body.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  expect(/^# /.test(body), file + " must open with a level-1 heading");
  expect(!/<[a-zA-Z!]/.test(prose), file + " must not contain HTML");
  expect(!/!\[/.test(prose), file + " must not contain images");
}
expect(read("marketplace/plugin.js") === read("plugin.js"), "marketplace/plugin.js differs from plugin.js");

// Every declared model is documented under its exact ID.
const { meta } = await import(new URL("../plugin.js", import.meta.url));
expect(meta.version === version, "plugin.js was not built from src/plugin.js " + version);
for (const file of ["README.md", "API.md"]) {
  const missing = meta.models.filter((model) => !read(file).includes("`" + model + "`"));
  expect(missing.length === 0, file + " does not list the declared models " + missing.join(", "));
}

if (problems.length) {
  for (const problem of problems) console.error("- " + problem);
  process.exit(1);
}
console.log("release files consistent for " + version);
