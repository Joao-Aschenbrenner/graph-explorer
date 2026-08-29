import fs from "fs";

const read = (p) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const write = (p, s) => fs.writeFileSync(p, s.replace(/\r?\n/g, "\n"), "utf8");
function replace(text, oldText, newText, label) {
  if (!text.includes(oldText)) throw new Error(`hardening não encontrou: ${label}`);
  console.log(`[hardening] ${label}`);
  return text.replace(oldText, newText);
}

let main = read("main.js");
main = replace(main,
`    const worker = new Worker(join(__dirname, "public", "graph-data-worker.cjs"), { workerData: { graphPath, projectPath } });`,
`    const workerFile = app.isPackaged
      ? join(process.resourcesPath, "app.asar.unpacked", "public", "graph-data-worker.cjs")
      : join(__dirname, "public", "graph-data-worker.cjs");
    const worker = new Worker(workerFile, { workerData: { graphPath, projectPath } });`,
"worker funciona em app.asar");
main = replace(main,
`  const labelStep = () => ({
    name: "Otimizando nomes das comunidades com IA (" + p.label + ")",
    args: ["label", ".", "--backend", p.backend, "--missing-only"],
    env: labelCfg.env,
  });`,
`  const labelStep = (missingOnly = true) => ({
    name: "Otimizando nomes das comunidades com IA (" + p.label + ")",
    args: missingOnly
      ? ["label", ".", "--backend", p.backend, "--missing-only"]
      : ["label", ".", "--backend", p.backend],
    env: labelCfg.env,
  });`,
"labelStep diferencia geração e relabel completo");
main = replace(main,
`    if (labelCfg.canLabel && p && p.backend) steps.push(labelStep());`,
`    if (labelCfg.canLabel && p && p.backend) steps.push(labelStep(true));`,
"generate mantém missing-only");
main = replace(main,
`    steps.push(labelStep());
  }
  return steps;`,
`    steps.push(labelStep(false));
  }
  return steps;`,
"relabel substitui labels genéricos");
main = replace(main,
`        if (config.provider === "nvidia") {`,
`        if (["nvidia", "opencode_zen", "opencode_go"].includes(config.provider)) {`,
"teste mínimo de inferência OpenCode/NVIDIA");
main = replace(main,
`          return { ok: true, message: "Chave e modelo NVIDIA validados (inferência OK)" };`,
`          return { ok: true, message: "Chave e modelo validados (inferência OK)" };`,
"mensagem genérica de inferência");
write("main.js", main);

let worker = read("public/graph-data-worker.cjs");
worker = replace(worker, "const MAX_GRAPH_BYTES = 768 * 1024 * 1024;", "const MAX_GRAPH_BYTES = 256 * 1024 * 1024;", "limite de memória do graph.json");
write("public/graph-data-worker.cjs", worker);

const pkg = JSON.parse(read("package.json"));
pkg.build = pkg.build || {};
pkg.build.asarUnpack = Array.from(new Set([...(pkg.build.asarUnpack || []), "public/graph-data-worker.cjs"]));
write("package.json", JSON.stringify(pkg, null, 2) + "\n");

const lock = JSON.parse(read("package-lock.json"));
if (lock.packages?.[""]) lock.packages[""].version = pkg.version;
write("package-lock.json", JSON.stringify(lock, null, 2) + "\n");

console.log("V115_HARDENING_APPLIED");
