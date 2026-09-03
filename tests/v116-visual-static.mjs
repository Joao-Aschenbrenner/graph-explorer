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
  "nodeRadius",
]) assert.ok(viewer.includes(needle), `viewer sem ${needle}`);

assert.ok(viewer.includes("nodeRadius") || viewer.includes("baseRadius"), "viewer sem cálculo de raio do nó");
assert.ok(viewer.includes("Passe o mouse") || viewer.includes("Clique em um nó") || viewer.includes("Arraste um nó"), "viewer sem orientação de interação");

for (const type of [
  "directory", "file", "class", "function", "interface",
  "config", "dependency", "endpoint", "community", "generic"
]) {
  assert.ok(viewer.includes(`${type}:`), `viewer sem tipo ${type}`);
  assert.ok(worker.includes(`"${type}"`), `worker sem classificação ${type}`);
}

assert.ok(viewer.includes("Math.log2") || viewer.includes("Math.sqrt"), "viewer perdeu escala controlada de nós");
assert.ok(viewer.includes("clamp("), "viewer perdeu limites de tamanho/layout");
assert.ok(worker.includes("typeCounts"), "worker sem typeCounts");

console.log("V116_VISUAL_STATIC_PASS");
