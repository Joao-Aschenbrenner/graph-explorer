import assert from "node:assert/strict";
import fs from "node:fs";

const main = fs.readFileSync("main.js", "utf8");
const preload = fs.readFileSync("preload.cjs", "utf8");
const ui = fs.readFileSync("public/index.html", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

for (const needle of [
  "opencode_zen",
  "opencode_go",
  "mistral",
  'ipcMain.handle("provider:models"',
  'ipcMain.handle("graph:data"',
  "graph-data-worker.cjs",
  "fetchProviderModels",
  "openCodeGraphifyCompatible",
]) assert.ok(main.includes(needle), `main.js sem contrato: ${needle}`);

for (const needle of ["listModels", "loadGraphData"]) assert.ok(preload.includes(needle), `preload sem ${needle}`);

for (const needle of [
  'id="modelSelect"',
  "refreshModels",
  "openJsonGraph",
  "graph-json-viewer.js",
  "OpenCode Go",
  "OpenCode Zen",
  "Mistral",
  "Ollama (local)",
  "Pesado / preciso",
]) assert.ok(ui.includes(needle), `UI sem contrato: ${needle}`);

assert.equal(pkg.version, "1.1.5");
assert.ok(pkg.build.files.includes("public/**/*"), "build precisa incluir worker/viewer em public/**/*");
if (Array.isArray(pkg.build.asarUnpack)) {
  assert.ok(pkg.build.asarUnpack.includes("public/graph-data-worker.cjs"), "worker precisa ficar em asarUnpack");
}

for (const status of ["no-graph", "graph-no-ia", "graph-with-ia"]) {
  assert.ok(main.includes(status), `main perdeu status ${status}`);
  assert.ok(ui.includes(status), `UI perdeu status ${status}`);
}

assert.ok(!ui.includes('id="modelInput"'), "campo de modelo manual antigo ainda existe");
assert.ok(!main.includes("C:\\Users\\USUARIO"), "main contém caminho local hardcoded");

console.log("V115_STATIC_CONTRACT_PASS");
