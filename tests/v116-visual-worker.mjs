import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKER = path.join(ROOT, "public", "graph-data-worker.cjs");

async function runWorker(projectPath) {
  return await new Promise((resolve, reject) => {
    const graphPath = path.join(projectPath, "graphify-out", "graph.json");
    const worker = new Worker(WORKER, { workerData: { graphPath, projectPath } });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error("worker timeout")); }, 15000);
    worker.once("message", (message) => { clearTimeout(timer); worker.terminate(); resolve(message); });
    worker.once("error", reject);
  });
}

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ge-v116-"));
const out = path.join(dir, "graphify-out");
await fs.mkdir(out, { recursive: true });
await fs.writeFile(path.join(out, "graph.json"), JSON.stringify({
  nodes: [
    { id: "folder", label: "src", kind: "directory", community: 0 },
    { id: "file", label: "main.ts", source_file: "src/main.ts", type: "file", community: 0 },
    { id: "klass", label: "UserService", type: "class", community: 1 },
    { id: "fn", label: "handleLogin", type: "function", community: 1 },
    { id: "iface", label: "AuthContract", type: "interface", community: 1 },
    { id: "cfg", label: "package.json", source_file: "package.json", community: 2 },
    { id: "dep", label: "express dependency", type: "dependency", community: 2 },
    { id: "api", label: "POST /login route", type: "endpoint", community: 3 },
    { id: "other", label: "mystery", community: 3 }
  ],
  edges: [
    { source: "file", target: "klass" },
    { source: "klass", target: "fn" },
    { source: "fn", target: "api" }
  ]
}));

const result = await runWorker(dir);
assert.equal(result.ok, true);
assert.equal(result.mode, "nodes");
const types = Object.fromEntries(result.nodes.map((n) => [n.id, n.type]));
assert.equal(types.folder, "directory");
assert.equal(types.file, "file");
assert.equal(types.klass, "class");
assert.equal(types.fn, "function");
assert.equal(types.iface, "interface");
assert.equal(types.cfg, "config");
assert.equal(types.dep, "dependency");
assert.equal(types.api, "endpoint");
assert.equal(types.other, "generic");
for (const key of ["directory","file","class","function","interface","config","dependency","endpoint","generic"]) {
  assert.equal(result.stats.typeCounts[key], 1, `count ${key}`);
}
await fs.rm(dir, { recursive: true, force: true });
console.log("V116_VISUAL_WORKER_PASS");
