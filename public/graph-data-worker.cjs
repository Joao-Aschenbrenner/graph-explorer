const { parentPort, workerData } = require("worker_threads");
const fs = require("fs");
const path = require("path");

const MAX_GRAPH_BYTES = 256 * 1024 * 1024;
const FULL_NODE_LIMIT = 2500;
const FULL_EDGE_LIMIT = 25000;
const META_NODE_LIMIT = 800;

const CONFIG_NAMES = new Set([
  "package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock",
  "tsconfig.json", "jsconfig.json", "vite.config.js", "vite.config.ts",
  "webpack.config.js", "eslint.config.js", ".eslintrc", ".prettierrc",
  "pyproject.toml", "requirements.txt", "setup.py", "tox.ini",
  "pom.xml", "build.gradle", "settings.gradle", "cargo.toml", "go.mod",
  "composer.json", "dockerfile", "docker-compose.yml", "docker-compose.yaml",
  ".env", ".env.example", ".gitignore", "manifest.json"
]);
const CONFIG_EXTS = new Set([".json", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".properties"]);
const SOURCE_EXTS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".py", ".java", ".kt", ".kts",
  ".go", ".rs", ".php", ".cs", ".cpp", ".cc", ".c", ".h", ".hpp", ".rb", ".swift",
  ".vue", ".svelte", ".html", ".css", ".scss", ".sql", ".sh", ".ps1"
]);

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

function nodeLabel(node) {
  return String(node?.label ?? node?.name ?? node?.title ?? node?.id ?? "node");
}

function nodeSource(node) {
  return String(node?.source_file ?? node?.file ?? node?.path ?? node?.module_path ?? node?.module ?? "");
}

function rawType(node) {
  return String(node?.file_type ?? node?.type ?? node?.kind ?? node?.node_type ?? "");
}

function classifyType(node) {
  const raw = rawType(node).toLowerCase();
  const label = nodeLabel(node).toLowerCase();
  const source = nodeSource(node).toLowerCase();
  const candidate = source || label;
  const base = path.basename(candidate).toLowerCase();
  const ext = path.extname(candidate).toLowerCase();

  if (/\b(community|cluster)\b/.test(raw)) return "community";
  if (/\b(interface|protocol|trait|contract)\b/.test(raw) || /\b(interface|protocol|trait|contract)\b/.test(label)) return "interface";
  if (/\b(function|method|callable|lambda|procedure|constructor)\b/.test(raw)) return "function";
  if (/\b(endpoint|route|http|request|response)\b/.test(raw) || /\b(route|endpoint|api)\b/.test(label)) return "endpoint";
  if (/\b(class|struct|component|entity|service|repository|controller|model)\b/.test(raw)) return "class";
  if (/\b(directory|folder|namespace|module)\b/.test(raw)) return "directory";
  if (/\b(dependency|library|external|import|package-dependency)\b/.test(raw)) return "dependency";
  if (/\b(config|configuration|manifest|setting)\b/.test(raw) || CONFIG_NAMES.has(base) || CONFIG_EXTS.has(ext)) return "config";
  if (/\b(file|document|source)\b/.test(raw) || SOURCE_EXTS.has(ext)) return "file";

  if (/(controller|service|repository|component|entity|model)$/.test(label.replace(/[^a-z0-9]+/g, ""))) return "class";
  if (/\b(handler|resolver|middleware|callback)\b/.test(label)) return "function";
  if (/\b(package|dependency|library|vendor)\b/.test(label)) return "dependency";
  if (source && !ext && /[\\\/]$/.test(source)) return "directory";
  if (ext) return "file";
  return "generic";
}

function addCount(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function mapToObject(map) {
  return Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1]));
}

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
  const typeCounts = new Map();
  for (const n of rawNodes) {
    const id = endpointId(n.id ?? n.name ?? n.label);
    if (id) { known.add(id); degrees.set(id, 0); }
    addCount(typeCounts, classifyType(n));
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
      return {
        id,
        label: nodeLabel(n),
        community,
        communityLabel: labels[community] || `Community ${community}`,
        type: classifyType(n),
        rawType: rawType(n),
        sourceFile: nodeSource(n),
        degree: degrees.get(id) || 0,
        size: 1
      };
    });
    parentPort.postMessage({
      ok: true,
      mode: "nodes",
      nodes,
      edges: normalizedEdges.slice(0, FULL_EDGE_LIMIT),
      stats: {
        nodes: rawNodes.length,
        edges: normalizedEdges.length,
        communities: new Set(nodes.map((n) => n.community)).size,
        graphBytes: stat.size,
        truncatedEdges: normalizedEdges.length > FULL_EDGE_LIMIT,
        typeCounts: mapToObject(typeCounts)
      }
    });
    return;
  }

  const communities = new Map();
  const nodeToCommunity = new Map();
  for (const n of rawNodes) {
    const id = endpointId(n.id ?? n.name ?? n.label);
    const community = communityOf(n);
    const visualType = classifyType(n);
    nodeToCommunity.set(id, community);
    if (!communities.has(community)) communities.set(community, { id: community, count: 0, samples: [], types: new Map() });
    const c = communities.get(community);
    c.count += 1;
    if (c.samples.length < 5) c.samples.push(nodeLabel(n));
    addCount(c.types, visualType);
  }

  const ranked = [...communities.values()].sort((a, b) => b.count - a.count);
  const kept = new Set(ranked.slice(0, META_NODE_LIMIT).map((c) => c.id));
  const hasOther = ranked.length > META_NODE_LIMIT;
  const metaNodes = ranked.slice(0, META_NODE_LIMIT).map((c) => {
    const dominantType = [...c.types.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "generic";
    return {
      id: `community:${c.id}`,
      community: c.id,
      label: labels[c.id] || `Community ${c.id}`,
      size: c.count,
      count: c.count,
      samples: c.samples,
      type: "community",
      dominantType,
      typeCounts: mapToObject(c.types)
    };
  });
  if (hasOther) {
    const rest = ranked.slice(META_NODE_LIMIT);
    metaNodes.push({
      id: "community:other",
      community: "other",
      label: `Outras ${rest.length} comunidades`,
      size: rest.reduce((sum, c) => sum + c.count, 0),
      count: rest.reduce((sum, c) => sum + c.count, 0),
      samples: rest.slice(0, 5).map((c) => labels[c.id] || `Community ${c.id}`),
      type: "community",
      dominantType: "generic",
      typeCounts: {}
    });
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
  const metaEdges = [...pairWeights.entries()].map(([key, weight]) => {
    const [a, b] = key.split("\u0000");
    return { source: `community:${a}`, target: `community:${b}`, relation: "community-link", weight };
  });

  parentPort.postMessage({
    ok: true,
    mode: "communities",
    nodes: metaNodes,
    edges: metaEdges,
    stats: {
      nodes: rawNodes.length,
      edges: normalizedEdges.length,
      communities: communities.size,
      graphBytes: stat.size,
      aggregated: true,
      visibleCommunities: metaNodes.length,
      typeCounts: mapToObject(typeCounts)
    }
  });
}

main().catch((error) => parentPort.postMessage({ ok: false, error: error.message }));
