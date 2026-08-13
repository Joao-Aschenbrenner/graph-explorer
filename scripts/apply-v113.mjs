import fs from "fs";

const read = (p) => fs.readFileSync(p, "utf8");
const write = (p, s) => fs.writeFileSync(p, s.replace(/\r?\n/g, "\n"), "utf8");

function replaceRx(text, rx, replacement, label) {
  const match = text.match(rx);
  if (!match) throw new Error(`Patch não encontrou: ${label}`);
  const out = text.replace(rx, replacement);
  if (out === text) throw new Error(`Patch não alterou: ${label}`);
  console.log(`[patch] ${label}`);
  return out;
}

function replaceText(text, from, to, label) {
  if (!text.includes(from)) throw new Error(`Patch não encontrou: ${label}`);
  console.log(`[patch] ${label}`);
  return text.replace(from, to);
}

// ── main.js ───────────────────────────────────────────────────
let main = read("main.js");

main = replaceRx(
  main,
  /\/\/ ── Workspace scan ─+[\s\S]*?\/\/ ── Runner \(async, single job, jobId\) ─+/,
`// ── Workspace scan ────────────────────────────────────────────
const IGNORE_DIRS = new Set([
  "node_modules", ".git", "venv", ".venv", "dist", "build", "target",
  "__pycache__", ".idea", ".vscode", "coverage"
]);

function graphHtmlPath(p) { return join(p, "graphify-out", "graph.html"); }
function graphJsonPath(p) { return join(p, "graphify-out", "graph.json"); }

async function fileHasUsefulContent(file) {
  try {
    const st = await fsp.stat(file);
    if (!st.isFile() || st.size < 3) return false;
    const text = await fsp.readFile(file, "utf8");
    if (!text.trim()) return false;
    try {
      const data = JSON.parse(text);
      if (Array.isArray(data)) return data.length > 0;
      if (data && typeof data === "object") return Object.keys(data).length > 0;
    } catch {}
    return true;
  } catch {
    return false;
  }
}

async function hasAiOptimization(projectPath) {
  const out = join(projectPath, "graphify-out");
  const labelFiles = [
    join(out, ".graphify_labels.json"),
    join(projectPath, ".graphify_labels.json"),
  ];
  for (const file of labelFiles) {
    if (await fileHasUsefulContent(file)) return true;
  }

  const reportCandidates = [
    join(out, "GRAPH_REPORT.md"),
    join(projectPath, "GRAPH_REPORT.md"),
  ];
  for (const reportPath of reportCandidates) {
    try {
      const report = await fsp.readFile(reportPath, "utf8");
      if (/\\blabel(?:ed)?\\s*:\\s*true\\b/i.test(report) ||
          /\\bia[-_ ]?label(?:ed|ing)?\\s*:\\s*true\\b/i.test(report)) return true;
    } catch {}
  }
  return false;
}

async function inspectWorkspaceFolder(name, p) {
  const graphJson = graphJsonPath(p);
  const graphHtml = graphHtmlPath(p);
  const hasGraph = existsSync(graphJson) || existsSync(graphHtml);
  let status = "no-graph";
  if (hasGraph) status = (await hasAiOptimization(p)) ? "graph-with-ia" : "graph-no-ia";
  return {
    name,
    path: p,
    status,
    graphUrl: existsSync(graphHtml) ? pathToFileURL(graphHtml).href : null,
    hasGraphJson: existsSync(graphJson),
    hasGraphHtml: existsSync(graphHtml),
  };
}

async function scanWorkspace(root) {
  const projects = [];
  let dirs = [];
  try {
    dirs = (await fsp.readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && !IGNORE_DIRS.has(e.name));
  } catch {
    return { root, projects };
  }

  // O Explorer mostra TODAS as pastas imediatas do workspace, não só repositórios.
  for (const d of dirs) {
    try {
      projects.push(await inspectWorkspaceFolder(d.name, join(root, d.name)));
    } catch {
      projects.push({ name: d.name, path: join(root, d.name), status: "error", graphUrl: null });
    }
  }

  projects.sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
  return { root, projects };
}

// ── Runner (async, single job, jobId) ─────────────────────────`,
  "workspace: 3 estados + todas as pastas"
);

main = replaceRx(
  main,
  /function buildSteps\(operation, labelCfg\) \{[\s\S]*?\n\}\nfunction spawnStep/,
`function buildSteps(operation, labelCfg) {
  const steps = [];
  const p = PROVIDERS[labelCfg.provider];
  const labelStep = () => ({
    name: "Otimizando nomes das comunidades com IA (" + p.label + ")",
    args: ["label", ".", "--backend", p.backend, "--missing-only"],
    env: labelCfg.env,
  });

  if (operation === "generate") {
    steps.push({ name: "Extraindo estrutura do código (AST)", args: ["extract", ".", "--code-only"] });
    steps.push({ name: "Agrupando comunidades", args: ["cluster-only", "."] });
    if (labelCfg.canLabel && p && p.backend) steps.push(labelStep());
  } else if (operation === "update") {
    if (graphifyCaps && graphifyCaps.update) {
      steps.push({ name: "Atualizando grafo", args: ["update", "."] });
    } else {
      steps.push({ name: "Extraindo estrutura do código (AST)", args: ["extract", ".", "--code-only"] });
      steps.push({ name: "Agrupando comunidades", args: ["cluster-only", "."] });
    }
  } else if (operation === "recluster") {
    steps.push({ name: "Reagrupando comunidades", args: ["cluster-only", "."] });
  } else if (operation === "relabel") {
    if (!p || !p.backend) throw new Error("Provedor sem backend de IA");
    steps.push(labelStep());
  }
  return steps;
}
function spawnStep`,
  "runner: gerar + IA opcional"
);

main = replaceText(
  main,
`    return { installed: false, version: null, update: false, extract: false, clusterOnly: false, label: false };`,
`    return { installed: false, version: null, update: false, extract: false, clusterOnly: false, label: false, installable: process.platform === "win32" };`,
  "probe: installable quando ausente"
);

main = replaceText(
  main,
`    return caps;`,
`    caps.installable = false;
    return caps;`,
  "probe: installed não precisa instalar"
);

main = replaceText(
  main,
`  ipcMain.handle("provider:test", async (_e, config) => {`,
`  ipcMain.handle("graphify:install", async () => {
    if (process.platform !== "win32") return { ok: false, error: "Instalação automática disponível apenas no Windows nesta versão." };
    try {
      await new Promise((resolve, reject) => {
        const child = spawn("npm", ["install", "-g", "graphifyy"], { windowsHide: true, shell: true });
        let output = "";
        child.stdout.on("data", (d) => (output += d.toString()));
        child.stderr.on("data", (d) => (output += d.toString()));
        child.on("error", reject);
        child.on("close", (code) => code === 0 ? resolve(output) : reject(new Error(output || "npm saiu com código " + code)));
      });
      graphifyCaps = await probeGraphify();
      return { ok: graphifyCaps.installed, caps: graphifyCaps, message: graphifyCaps.installed ? "Graphify instalado com sucesso." : "A instalação terminou, mas o comando graphify ainda não foi encontrado." };
    } catch (e) {
      graphifyCaps = await probeGraphify();
      return { ok: false, caps: graphifyCaps, error: e.message };
    }
  });

  ipcMain.handle("provider:test", async (_e, config) => {`,
  "IPC: instalar Graphify"
);

main = replaceText(
  main,
`      env: labelEnv(provider || cfg.provider || "none", { endpoint: endpoint || cfg.endpoint, model: model || cfg.model }, providerKey),
    };`,
`      env: labelEnv(provider || cfg.provider || "none", { endpoint: endpoint || cfg.endpoint, model: model || cfg.model }, providerKey),
      canLabel: (provider || cfg.provider || "none") !== "none" &&
        (Boolean(providerKey) || (provider || cfg.provider) === "ollama"),
    };`,
  "runner: canLabel"
);

write("main.js", main);

// ── preload.cjs ────────────────────────────────────────────────
let preload = read("preload.cjs");
preload = replaceText(
  preload,
`  detectGraphify: () => ipcRenderer.invoke("graphify:detect"),`,
`  detectGraphify: () => ipcRenderer.invoke("graphify:detect"),

  installGraphify: () => ipcRenderer.invoke("graphify:install"),`,
  "preload: installGraphify"
);
write("preload.cjs", preload);

// ── public/index.html ─────────────────────────────────────────
let html = read("public/index.html");

html = replaceRx(
  html,
  /\.dot\{width:9px;height:9px;border-radius:50%;flex:none\}[\s\S]*?\.dot\.error\{background:#f85149\}/,
`.status-icon{width:18px;height:18px;min-width:18px;display:grid;place-items:center;flex:none}
.status-icon svg{width:18px;height:18px;display:block;filter:drop-shadow(0 0 4px currentColor)}
.status-icon.no-graph{color:#f85149}
.status-icon.graph-no-ia{color:#d29922}
.status-icon.graph-with-ia{color:#3fb950}
.status-icon.processing{color:#58a6ff;animation:pulse 1s infinite}
.status-icon.error{color:#f85149}
.status-legend{margin:4px 4px 10px;padding:8px;border:1px solid #21262d;border-radius:8px;background:#0b0f14}
.status-legend-row{display:flex;align-items:center;gap:7px;font-size:10px;color:#8b949e;line-height:1.45;margin:3px 0}
.status-pill{font-size:9px;font-weight:700;letter-spacing:.2px;padding:2px 6px;border-radius:999px;border:1px solid currentColor;opacity:.92}`,
  "CSS: SVG status icons"
);

html = replaceRx(
  html,
  /<div class="logo-wrap">[\s\S]*?<\/div>\n  <div class="logo-title">/,
`<div class="logo-wrap">
    <svg viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg" aria-label="Graph Explorer">
      <defs>
        <linearGradient id="geCore" x1="36" y1="28" x2="130" y2="134" gradientUnits="userSpaceOnUse">
          <stop stop-color="#58a6ff"/><stop offset=".5" stop-color="#a855f7"/><stop offset="1" stop-color="#3fb950"/>
        </linearGradient>
        <radialGradient id="geHalo"><stop stop-color="#58a6ff" stop-opacity=".28"/><stop offset="1" stop-color="#58a6ff" stop-opacity="0"/></radialGradient>
      </defs>
      <circle cx="80" cy="80" r="60" fill="url(#geHalo)"><animate attributeName="r" values="54;64;54" dur="3.8s" repeatCount="indefinite"/></circle>
      <g stroke-linecap="round">
        <path d="M80 80L43 42M80 80L117 42M80 80L132 82M80 80L116 123M80 80L45 122M80 80L28 80" stroke="#58a6ff" stroke-opacity=".36" stroke-width="1.5"/>
        <path d="M43 42L117 42M117 42L132 82M132 82L116 123M116 123L45 122M45 122L28 80M28 80L43 42" stroke="#a855f7" stroke-opacity=".2"/>
      </g>
      <g fill="#0a0a1a" stroke-width="2.5">
        <circle cx="43" cy="42" r="6" stroke="#a855f7"/><circle cx="117" cy="42" r="6" stroke="#58a6ff"/>
        <circle cx="132" cy="82" r="5" stroke="#3fb950"/><circle cx="116" cy="123" r="6" stroke="#a855f7"/>
        <circle cx="45" cy="122" r="5" stroke="#3fb950"/><circle cx="28" cy="80" r="5" stroke="#58a6ff"/>
      </g>
      <circle cx="80" cy="80" r="17" fill="#0a0a1a" stroke="url(#geCore)" stroke-width="4"/>
      <path d="M70 77l8 8 15-18" fill="none" stroke="url(#geCore)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="80" cy="80" r="25" fill="none" stroke="#58a6ff" stroke-opacity=".35"><animate attributeName="r" values="22;30;22" dur="2.4s" repeatCount="indefinite"/><animate attributeName="opacity" values=".4;0;.4" dur="2.4s" repeatCount="indefinite"/></circle>
    </svg>
  </div>
  <div class="logo-title">`,
  "logo splash"
);

html = replaceRx(
  html,
  /<svg viewBox="0 0 22 22" xmlns="http:\/\/www\.w3\.org\/2000\/svg">[\s\S]*?<\/svg>\n      Graph Explorer/,
`<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M12 12L5 5M12 12l7-7M12 12l7 7M12 12l-7 7" stroke="#58a6ff" stroke-width="1.2" opacity=".55"/>
        <circle cx="5" cy="5" r="2.2" fill="#a855f7"/><circle cx="19" cy="5" r="2.2" fill="#58a6ff"/>
        <circle cx="19" cy="19" r="2.2" fill="#3fb950"/><circle cx="5" cy="19" r="2.2" fill="#a855f7"/>
        <circle cx="12" cy="12" r="4" fill="#0d1117" stroke="#58a6ff" stroke-width="1.7"/>
        <path d="M10.3 12l1.15 1.2 2.45-2.7" fill="none" stroke="#3fb950" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      Graph Explorer`,
  "logo header"
);

html = replaceText(
  html,
`    <div class="warn-note hidden" id="safeWarn"></div>`,
`    <div class="warn-note hidden" id="safeWarn"></div>
    <div class="warn-note hidden" id="graphifyWarn"></div>`,
  "setup: Graphify notice"
);

html = replaceRx(
  html,
  /async function refreshSidebar\(\)\{[\s\S]*?\nfunction selectProject\(p\)\{/,
`async function refreshSidebar(){
  if (!state.workspace) return;
  const data = await api.scanWorkspace(state.workspace);
  state.projects = data.projects || [];
  renderSidebar();
}
function statusSvg(status){
  if (status === "graph-with-ia") return \`<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3l7 4v5c0 4.4-2.9 7.5-7 9-4.1-1.5-7-4.6-7-9V7l7-4z" stroke="currentColor" stroke-width="1.8"/><path d="m8.4 12.1 2.2 2.2 5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>\`;
  if (status === "graph-no-ia") return \`<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3.2 21 20H3L12 3.2z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 14.8h6M9.8 12l2.2-2 2.2 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="9" cy="14.8" r="1.25" fill="currentColor"/><circle cx="15" cy="14.8" r="1.25" fill="currentColor"/><circle cx="12" cy="10" r="1.25" fill="currentColor"/></svg>\`;
  if (status === "processing") return \`<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 5v5h-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>\`;
  if (status === "error") return \`<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.5v6M12 17h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>\`;
  return \`<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3.2 21 20H3L12 3.2z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 8.5v5M12 16.8h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>\`;
}
function statusMeta(status){
  if (status === "graph-with-ia") return ["Grafo otimizado com IA", "graph-with-ia"];
  if (status === "graph-no-ia") return ["Grafo criado · falta otimizar com IA", "graph-no-ia"];
  if (status === "processing") return ["Processando", "processing"];
  if (status === "error") return ["Erro ao analisar pasta", "error"];
  return ["Sem grafo", "no-graph"];
}
function renderSidebar(filter){
  const sb = $("sidebar");
  sb.innerHTML = "";
  const label = document.createElement("div"); label.className="ws-label"; label.textContent="WORKSPACE";
  sb.appendChild(label);
  const path = document.createElement("div"); path.className="ws-path"; path.textContent = state.workspace;
  sb.appendChild(path);

  const legend = document.createElement("div");
  legend.className = "status-legend";
  [
    ["no-graph","Sem grafo"],
    ["graph-no-ia","Grafo sem otimização IA"],
    ["graph-with-ia","Grafo otimizado com IA"],
  ].forEach(([status,text])=>{
    const row=document.createElement("div"); row.className="status-legend-row";
    const icon=document.createElement("span"); icon.className="status-icon "+status; icon.innerHTML=statusSvg(status);
    const desc=document.createElement("span"); desc.textContent=text;
    row.appendChild(icon); row.appendChild(desc); legend.appendChild(row);
  });
  sb.appendChild(legend);

  const list = state.projects.filter(p => !filter || p.name.toLowerCase().includes(filter));
  if (!list.length){ const e=document.createElement("div"); e.className="ws-path"; e.textContent="nenhuma pasta encontrada"; sb.appendChild(e); }
  list.forEach(p=>{
    const el = document.createElement("div"); el.className="proj" + (state.selected===p.path?" active":"");
    el.dataset.projectPath = p.path;
    const [statusLabel, statusClass] = statusMeta(p.status);
    const icon = document.createElement("div"); icon.className="status-icon "+statusClass; icon.innerHTML=statusSvg(p.status); icon.title=statusLabel;
    const name = document.createElement("div"); name.className="name"; name.textContent=p.name; name.title=p.name+" · "+statusLabel;
    const acts = document.createElement("div"); acts.className="acts";
    if (p.status==="graph-with-ia"){
      acts.appendChild(mini("Atualizar", ()=>runOp(p,"update")));
      acts.appendChild(mini("Nomes", ()=>runOp(p,"relabel")));
      acts.appendChild(mini("Reagrupar", ()=>runOp(p,"recluster")));
    } else if (p.status==="graph-no-ia"){
      acts.appendChild(mini("Atualizar", ()=>runOp(p,"update")));
      acts.appendChild(mini("Otimizar IA", ()=>runOp(p,"relabel")));
      acts.appendChild(mini("Reagrupar", ()=>runOp(p,"recluster")));
    } else if (p.status==="no-graph"){
      acts.appendChild(mini("Gerar", ()=>runOp(p,"generate")));
    }
    el.appendChild(icon); el.appendChild(name); el.appendChild(acts);
    el.onclick = ()=> selectProject(p);
    sb.appendChild(el);
  });
}
function mini(label, fn){ const b=document.createElement("button"); b.className="mini"; b.textContent=label; b.onclick=(e)=>{e.stopPropagation(); fn();}; return b; }

function selectProject(p){`,
  "sidebar: 3 status + SVG"
);

html = replaceRx(
  html,
  /function refreshCenter\(\)\{[\s\S]*?\n\}\nfunction openGraph/,
`function refreshCenter(){
  const p = state.projects.find(x=>x.path===state.selected);
  const c = $("center");
  if (!p){ c.innerHTML = '<div class="center-msg"><div class="big">Selecione um projeto na lateral</div></div>'; return; }

  if ((p.status==="graph-with-ia" || p.status==="graph-no-ia") && p.graphUrl){
    openGraph(p);
    return;
  }

  if ((p.status==="graph-with-ia" || p.status==="graph-no-ia") && !p.graphUrl){
    c.innerHTML = '<div class="center-msg"><div class="big">Grafo encontrado, mas a visualização HTML não existe</div><div class="small">Os dados graph.json foram detectados. Gere/atualize a visualização com o Graphify.</div><button class="btn" style="margin-top:14px" id="updateGraphBtn">Atualizar grafo</button></div>';
    $("updateGraphBtn").onclick = ()=>runOp(p,"update");
    return;
  }

  if (p.status==="no-graph"){
    c.innerHTML = '<div class="center-msg"><div class="big">Esta pasta ainda não possui grafo</div><div class="small">O Graphify analisa o código e gera a visualização. Se a IA estiver configurada, os nomes também serão otimizados.</div><button class="btn" style="margin-top:14px" id="genBtn">Gerar grafo</button></div>';
    $("genBtn").onclick = ()=>runOp(p,"generate");
    return;
  }

  c.innerHTML = '<div class="center-msg"><div class="big">'+p.name+'</div><div class="small">'+p.status+'</div></div>';
}
function openGraph`,
  "center: 3 estados"
);

html = replaceText(
  html,
`  try { state.graphify = await api.detectGraphify(); } catch {}`,
`  try { state.graphify = await api.detectGraphify(); } catch {}
  if (state.graphify && !state.graphify.installed) {
    $("splashMsg").textContent = "Graphify não encontrado — você poderá instalá-lo no setup";
  }`,
  "boot: Graphify ausente"
);

html = replaceText(
  html,
`  applySecurityState($("sessionOnly"), $("safeWarn"), state.config || { encryptionAvailable: true, sessionOnly: false });
  showView("setupView");`,
`  applySecurityState($("sessionOnly"), $("safeWarn"), state.config || { encryptionAvailable: true, sessionOnly: false });
  const graphifyWarn = $("graphifyWarn");
  if (state.graphify && !state.graphify.installed) {
    graphifyWarn.classList.remove("hidden");
    graphifyWarn.innerHTML = '⚠ Graphify é necessário para gerar/atualizar grafos. <button class="btn sec" id="btnInstallGraphify" style="margin-left:8px;padding:5px 9px">Instalar Graphify</button>';
    setTimeout(()=>{
      const b=$("btnInstallGraphify");
      if (b) b.onclick = async ()=>{
        b.disabled=true; b.textContent="Instalando...";
        const res = await api.installGraphify();
        if (res && res.ok) {
          state.graphify = res.caps;
          graphifyWarn.textContent = "✓ Graphify instalado: " + (res.caps.version || "ok");
          graphifyWarn.style.color = "#3fb950";
        } else {
          graphifyWarn.textContent = "✗ Falha ao instalar Graphify: " + ((res && (res.error || res.message)) || "erro");
          graphifyWarn.style.color = "#f85149";
        }
      };
    },0);
  } else {
    graphifyWarn.classList.add("hidden");
    graphifyWarn.textContent = "";
  }
  showView("setupView");`,
  "setup: instalar Graphify"
);

write("public/index.html", html);

// ── logo.svg ──────────────────────────────────────────────────
write("assets/logo.svg", `<svg width="512" height="512" viewBox="0 0 160 160" fill="none" xmlns="http://www.w3.org/2000/svg">
<defs>
  <linearGradient id="core" x1="36" y1="28" x2="130" y2="134" gradientUnits="userSpaceOnUse">
    <stop stop-color="#58A6FF"/><stop offset=".5" stop-color="#A855F7"/><stop offset="1" stop-color="#3FB950"/>
  </linearGradient>
  <radialGradient id="halo"><stop stop-color="#58A6FF" stop-opacity=".24"/><stop offset="1" stop-color="#58A6FF" stop-opacity="0"/></radialGradient>
</defs>
<circle cx="80" cy="80" r="65" fill="url(#halo)"/>
<g stroke-linecap="round">
  <path d="M80 80L43 42M80 80L117 42M80 80L132 82M80 80L116 123M80 80L45 122M80 80L28 80" stroke="#58A6FF" stroke-opacity=".5" stroke-width="1.8"/>
  <path d="M43 42L117 42M117 42L132 82M132 82L116 123M116 123L45 122M45 122L28 80M28 80L43 42" stroke="#A855F7" stroke-opacity=".24" stroke-width="1.2"/>
</g>
<g fill="#0D1117" stroke-width="3">
  <circle cx="43" cy="42" r="7" stroke="#A855F7"/><circle cx="117" cy="42" r="7" stroke="#58A6FF"/>
  <circle cx="132" cy="82" r="6" stroke="#3FB950"/><circle cx="116" cy="123" r="7" stroke="#A855F7"/>
  <circle cx="45" cy="122" r="6" stroke="#3FB950"/><circle cx="28" cy="80" r="6" stroke="#58A6FF"/>
</g>
<circle cx="80" cy="80" r="20" fill="#0D1117" stroke="url(#core)" stroke-width="5"/>
<path d="M68 78l9 9 17-20" stroke="url(#core)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`);

// ── build-icons.ps1 ───────────────────────────────────────────
write("assets/build-icons.ps1", `Add-Type -AssemblyName System.Drawing

$size = 256
$bmp = New-Object System.Drawing.Bitmap($size,$size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.Clear([System.Drawing.Color]::Transparent)
$cx = 128; $cy = 128

function Brush($r,$gg,$b,$a=255) { New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($a,$r,$gg,$b)) }
function Pen($r,$gg,$b,$a=255,$w=2) { New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb($a,$r,$gg,$b),$w) }

for ($i=0; $i -lt 7; $i++) {
  $r=72-$i*7; $a=[Math]::Max(8,38-$i*5)
  $b=Brush 88 166 255 $a
  $g.FillEllipse($b,$cx-$r,$cy-$r,$r*2,$r*2); $b.Dispose()
}

$nodes = @(
  @(70,67,168,85,247), @(186,67,88,166,255), @(211,130,63,185,80),
  @(184,196,168,85,247), @(72,195,63,185,80), @(44,128,88,166,255)
)

foreach ($n in $nodes) {
  $p=Pen $n[2] $n[3] $n[4] 95 2
  $g.DrawLine($p,$cx,$cy,$n[0],$n[1]); $p.Dispose()
}
foreach ($n in $nodes) {
  $b=Brush $n[2] $n[3] $n[4]
  $g.FillEllipse($b,$n[0]-7,$n[1]-7,14,14); $b.Dispose()
}

$p=Pen 88 166 255 255 7
$g.DrawEllipse($p,$cx-28,$cy-28,56,56); $p.Dispose()
$b=Brush 13 17 23
$g.FillEllipse($b,$cx-23,$cy-23,46,46); $b.Dispose()

$p=Pen 63 185 80 255 7
$p.StartCap='Round'; $p.EndCap='Round'
$g.DrawLines($p,[System.Drawing.Point[]]@(
  (New-Object System.Drawing.Point(111,129)),
  (New-Object System.Drawing.Point(124,141)),
  (New-Object System.Drawing.Point(149,111))
)); $p.Dispose()

$ms=New-Object System.IO.MemoryStream
$bmp.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png)
$pngBytes=$ms.ToArray()
$g.Dispose(); $bmp.Dispose()

$out=$PSScriptRoot
[System.IO.File]::WriteAllBytes((Join-Path $out 'icon.png'),$pngBytes)
[System.IO.File]::WriteAllBytes((Join-Path $out 'splash-logo.png'),$pngBytes)

$ico=New-Object System.IO.MemoryStream
$bw=New-Object System.IO.BinaryWriter($ico)
$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]1)
$bw.Write([byte]0); $bw.Write([byte]0); $bw.Write([byte]0); $bw.Write([byte]0)
$bw.Write([uint16]1); $bw.Write([uint16]32)
$bw.Write([uint32]$pngBytes.Length); $bw.Write([uint32]22); $bw.Write($pngBytes)
[System.IO.File]::WriteAllBytes((Join-Path $out 'icon.ico'),$ico.ToArray())
Write-Output "icons generated: png=$($pngBytes.Length) ico=$($ico.ToArray().Length)"
`);

for (const file of ["package.json", "package-lock.json"]) {
  const data = JSON.parse(read(file));
  data.version = "1.1.3";
  if (data.packages?.[""]) data.packages[""].version = "1.1.3";
  write(file, JSON.stringify(data, null, 2) + "\n");
}

console.log("Graph Explorer v1.1.3 patch aplicado.");
