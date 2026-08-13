import fs from "fs";

const read = (p) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const write = (p, s) => fs.writeFileSync(p, s.replace(/\r?\n/g, "\n"), "utf8");

function replaceRx(text, rx, replacement, label) {
  if (!rx.test(text)) throw new Error(`v1.1.4 patch não encontrou: ${label}`);
  console.log(`[v1.1.4] ${label}`);
  return text.replace(rx, replacement);
}

let main = read("main.js");
main = replaceRx(
  main,
  /async function hasAiOptimization\(projectPath\) \{[\s\S]*?\n\}\n\nasync function inspectWorkspaceFolder/,
`async function hasAiOptimization(projectPath) {
  let graphData = null;
  try {
    graphData = JSON.parse(await fsp.readFile(graphJsonPath(projectPath), "utf8"));
  } catch {
    return false;
  }

  const communityIds = new Set();
  const nodes = Array.isArray(graphData?.nodes) ? graphData.nodes : [];
  for (const node of nodes) {
    if (node?.community !== undefined && node?.community !== null) communityIds.add(String(node.community));
  }
  if (!communityIds.size) return false;

  const labels = {};
  if (graphData?.community_labels && typeof graphData.community_labels === "object") {
    Object.assign(labels, graphData.community_labels);
  }

  for (const file of [
    join(projectPath, "graphify-out", ".graphify_labels.json"),
    join(projectPath, ".graphify_labels.json"),
  ]) {
    try {
      const parsed = JSON.parse(await fsp.readFile(file, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        Object.assign(labels, parsed);
        break;
      }
    } catch {}
  }

  const hasSemanticName = (id) => {
    const value = labels[id] ?? labels[Number(id)];
    if (typeof value !== "string" || !value.trim()) return false;
    return !/^Community\\s+\\d+$/i.test(value.trim());
  };

  return [...communityIds].every(hasSemanticName);
}

async function inspectWorkspaceFolder`,
  "verde somente quando todas as comunidades têm nomes reais"
);
write("main.js", main);

let ps = read("assets/build-icons.ps1");
ps = ps
  .replace(/\(New-Object System\.Drawing\.Point\(111,129\)\)/g, "([System.Drawing.Point]::new(111,129))")
  .replace(/\(New-Object System\.Drawing\.Point\(124,141\)\)/g, "([System.Drawing.Point]::new(124,141))")
  .replace(/\(New-Object System\.Drawing\.Point\(149,111\)\)/g, "([System.Drawing.Point]::new(149,111))");
write("assets/build-icons.ps1", ps);

for (const file of ["package.json", "package-lock.json"]) {
  const data = JSON.parse(read(file));
  data.version = "1.1.4";
  if (data.packages?.[""]) data.packages[""].version = "1.1.4";
  write(file, JSON.stringify(data, null, 2) + "\n");
}

console.log("Graph Explorer v1.1.4 status patch aplicado.");
