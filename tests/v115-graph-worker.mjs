import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKER = path.join(ROOT, "public", "graph-data-worker.cjs");

async function runWorker(projectPath) {
  const graphPath = path.join(projectPath, "graphify-out", "graph.json");
  return await new Promise((resolve, reject) => {
    const worker = new Worker(WORKER, { workerData: { graphPath, projectPath } });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error("worker timeout")); }, 20000);
    worker.once("message", (message) => { clearTimeout(timer); worker.terminate(); resolve(message); });
    worker.once("error", (error) => { clearTimeout(timer); reject(error); });
  });
}

async function fixture(name, graph, labels = null) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `ge-v115-${name}-`));
  const out = path.join(dir, "graphify-out");
  await fs.mkdir(out, { recursive: true });
  await fs.writeFile(path.join(out, "graph.json"), JSON.stringify(graph));
  if (labels) await fs.writeFile(path.join(out, ".graphify_labels.json"), JSON.stringify(labels));
  return dir;
}

const smallDir = await fixture("small", {
  nodes: [
    { id: "a", label: "Auth", community: 0, type: "module" },
    { id: "b", label: "Login", community: 0, type: "function" },
    { id: "c", label: "DB", community: 1, type: "module" },
  ],
  links: [
    { source: "a", target: "b", relation: "calls" },
    { source: "b", target: "c", relation: "uses" },
  ],
  community_labels: { 0: "Authentication", 1: "Persistence" },
});
const small = await runWorker(smallDir);
assert.equal(small.ok, true);
assert.equal(small.mode, "nodes");
assert.equal(small.stats.nodes, 3);
assert.equal(small.stats.edges, 2);
assert.equal(small.stats.communities, 2);
assert.equal(small.nodes.find((n) => n.id === "a")?.communityLabel, "Authentication");
await fs.rm(smallDir, { recursive: true, force: true });

const bigNodes = Array.from({ length: 2600 }, (_, i) => ({
  id: `n${i}`,
  label: `Node ${i}`,
  community: i % 4,
  type: i % 2 ? "function" : "module",
}));
const bigEdges = Array.from({ length: 2599 }, (_, i) => ({ source: `n${i}`, target: `n${i + 1}` }));
const bigDir = await fixture("big", { nodes: bigNodes, edges: bigEdges }, {
  0: "Frontend",
  1: "Backend",
  2: "Storage",
  3: "Infrastructure",
});
const big = await runWorker(bigDir);
assert.equal(big.ok, true);
assert.equal(big.mode, "communities");
assert.equal(big.stats.nodes, 2600);
assert.equal(big.stats.communities, 4);
assert.equal(big.nodes.length, 4);
assert.ok(big.edges.length > 0);
assert.deepEqual(new Set(big.nodes.map((n) => n.label)), new Set(["Frontend", "Backend", "Storage", "Infrastructure"]));
await fs.rm(bigDir, { recursive: true, force: true });

console.log("V115_GRAPH_WORKER_PASS");
