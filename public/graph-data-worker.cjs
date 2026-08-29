const { parentPort, workerData } = require("worker_threads");
const fs = require("fs");
const path = require("path");

const MAX_GRAPH_BYTES = 768 * 1024 * 1024;
const FULL_NODE_LIMIT = 2500;
const FULL_EDGE_LIMIT = 25000;
const META_NODE_LIMIT = 800;

function endpointId(value) {
  if (value && typeof value === "object") return String(value.id ?? value.name ?? value.label ?? "");
  return String(value ?? "");
}

function mergeLabels(target, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const candidates = [value, value.labels, value.community_labels, value.communities];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    for (const [key, raw] of Object.entries(candidate)) {
      if (typeof raw === "string" && raw.trim()) target[String(key)] = raw.trim();
      else if (raw && typeof raw === "object") {
        const label = raw.label ?? raw.name ?? raw.title;
        if (typeof label === "string" && label.trim()) target[String(key)] = label.trim();
      }
    }
  }
}

async function readJsonIfExists(file) {
  try { return JSON.parse(await fs.promises.readFile(file, "utf8")); }
  catch { return null; }
}

function communityOf(node) {
  const raw = node?.community ?? node?.community_id ?? node?.group;
  return raw === undefined || raw === null || raw === "" ? "unclustered" : String(raw);
}
function nodeLabel(node) { return String(node?.label ?? node?.name ?? node?.title ?? node?.id ?? "node"); }
function classifyType(node) { return String(node?.file_type ?? node?.type ?? node?.kind ?? "node"); }

async function main() {
  const graphPath = workerData.graphPath;
  const projectPath = workerData.projectPath;
  const stat = await fs.promises.stat(graphPath);
  if (!stat.isFile()) throw new Error("graph.json inválido");
  if (stat.size > MAX_GRAPH_BYTES) throw new Error(`graph.json excede o limite seguro do visualizador (${Math.round(stat.size / 1024 / 1024)} MB)`);

  const graph = JSON.parse(await fs.promises.readFile(graphPath, "utf8"));
  const rawNodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const rawEdges = Array.isArray(graph?.links) ? graph.links : (Array.isArray(graph?.edges) ? graph.edges : []);
  if (!rawNodes.length) throw new Error("graph.json não contém nós");

  const labels = {};
  mergeLabels(labels, graph?.community_labels);
  for (const file of [path.join(projectPath, "graphify-out", ".graphify_labels.json"), path.join(projectPath, ".graphify_labels.json")]) {
    mergeLabels(labels, await readJsonIfExists(file));
  }

  const known = new Set();
  const degrees = new Map();
  for (const n of rawNodes) {
    const id = endpointId(n.id ?? n.name ?? n.label);
    if (id) { known.add(id); degrees.set(id, 0); }
  }

  const normalizedEdges = [];
  for (const e of rawEdges) {
    const source = endpointId(e?.source ?? e?.from);
    const target = endpointId(e?.target ?? e?.to);
    if (!source || !target || !known.has(source) || !known.has(target)) continue;
    degrees.set(source, (degrees.get(source) || 0) + 1);
    degrees.set(target, (degrees.get(target) || 0) + 1);
    normalizedEdges.push({ source, target, relation: String(e?.relation ?? e?.type ?? ""), weight: Number(e?.weight ?? 1) || 1 });
  }

  if (rawNodes.length <= FULL_NODE_LIMIT) {
    const nodes = rawNodes.map((n, index) => {
      const id = endpointId(n.id ?? n.name ?? n.label) || `node-${index}`;
      const community = communityOf(n);
      return { id, label: nodeLabel(n), community, communityLabel: labels[community] || `Community ${community}`, type: classifyType(n), sourceFile: String(n?.source_file ?? n?.file ?? ""), degree: degrees.get(id) || 0, size: 1 };
    });
    parentPort.postMessage({ ok: true, mode: "nodes", nodes, edges: normalizedEdges.slice(0, FULL_EDGE_LIMIT), stats: { nodes: rawNodes.length, edges: normalizedEdges.length, communities: new Set(nodes.map((n) => n.community)).size, graphBytes: stat.size, truncatedEdges: normalizedEdges.length > FULL_EDGE_LIMIT } });
    return;
  }

  const communities = new Map();
  const nodeToCommunity = new Map();
  for (const n of rawNodes) {
    const id = endpointId(n.id ?? n.name ?? n.label);
    const community = communityOf(n);
    nodeToCommunity.set(id, community);
    if (!communities.has(community)) communities.set(community, { id: community, count: 0, samples: [], types: new Map() });
    const c = communities.get(community);
    c.count += 1;
    if (c.samples.length < 5) c.samples.push(nodeLabel(n));
    const type = classifyType(n);
    c.types.set(type, (c.types.get(type) || 0) + 1);
  }

  const ranked = [...communities.values()].sort((a, b) => b.count - a.count);
  const kept = new Set(ranked.slice(0, META_NODE_LIMIT).map((c) => c.id));
  const hasOther = ranked.length > META_NODE_LIMIT;
  const metaNodes = ranked.slice(0, META_NODE_LIMIT).map((c) => ({ id: `community:${c.id}`, community: c.id, label: labels[c.id] || `Community ${c.id}`, size: c.count, count: c.count, samples: c.samples, type: [...c.types.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "community" }));
  if (hasOther) {
    const rest = ranked.slice(META_NODE_LIMIT);
    metaNodes.push({ id: "community:other", community: "other", label: `Outras ${rest.length} comunidades`, size: rest.reduce((sum, c) => sum + c.count, 0), count: rest.reduce((sum, c) => sum + c.count, 0), samples: rest.slice(0, 5).map((c) => labels[c.id] || `Community ${c.id}`), type: "community" });
  }

  const pairWeights = new Map();
  for (const e of normalizedEdges) {
    let a = nodeToCommunity.get(e.source) || "unclustered";
    let b = nodeToCommunity.get(e.target) || "unclustered";
    if (!kept.has(a)) a = "other";
    if (!kept.has(b)) b = "other";
    if (a === b) continue;
    const key = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
    pairWeights.set(key, (pairWeights.get(key) || 0) + 1);
  }
  const metaEdges = [...pairWeights.entries()].map(([key, weight]) => { const [a, b] = key.split("\u0000"); return { source: `community:${a}`, target: `community:${b}`, relation: "community-link", weight }; });

  parentPort.postMessage({ ok: true, mode: "communities", nodes: metaNodes, edges: metaEdges, stats: { nodes: rawNodes.length, edges: normalizedEdges.length, communities: communities.size, graphBytes: stat.size, aggregated: true, visibleCommunities: metaNodes.length } });
}

main().catch((error) => parentPort.postMessage({ ok: false, error: error.message }));
