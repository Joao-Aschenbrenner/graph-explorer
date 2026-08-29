import assert from "node:assert/strict";
import fs from "node:fs";

const viewer = fs.readFileSync("public/graph-json-viewer.js", "utf8");
const worker = fs.readFileSync("public/graph-data-worker.cjs", "utf8");

for (const needle of [
  "TYPE_META",
  "ICON_PATHS",
  "jgv-legend",
  "jgv-tooltip",
  "drawIcon",
  "baseRadius",
  "screenRadius",
  "rgba(145,166,192,.24)",
  "Passe o mouse ou clique em um nó",
]) assert.ok(viewer.includes(needle), `viewer sem ${needle}`);

for (const type of [
  "directory", "file", "class", "function", "interface",
  "config", "dependency", "endpoint", "community", "generic"
]) {
  assert.ok(viewer.includes(`${type}:`), `viewer sem tipo ${type}`);
  assert.ok(worker.includes(`"${type}"`), `worker sem classificação ${type}`);
}

assert.ok(viewer.includes("Math.log2(1 + Number(n.size || 1)) * .82"), "community radius não foi reduzido");
assert.ok(viewer.includes("Math.log2(1 + Number(n.degree || 0)) * .38"), "node radius não foi reduzido");
assert.ok(worker.includes("typeCounts"), "worker sem typeCounts");

console.log("V116_VISUAL_STATIC_PASS");
