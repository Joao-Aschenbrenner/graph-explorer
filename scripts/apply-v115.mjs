import fs from "fs";

const read = (p) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const write = (p, s) => fs.writeFileSync(p, s.replace(/\r?\n/g, "\n"), "utf8");

function replaceText(text, oldText, newText, label) {
  if (!text.includes(oldText)) throw new Error(`v1.1.5 patch não encontrou: ${label}`);
  console.log(`[v1.1.5] ${label}`);
  return text.replace(oldText, newText);
}
function replaceRx(text, rx, replacement, label) {
  if (!rx.test(text)) throw new Error(`v1.1.5 patch não encontrou: ${label}`);
  console.log(`[v1.1.5] ${label}`);
  return text.replace(rx, replacement);
}

let main = read("main.js");
main = replaceText(main, 'import { join, dirname } from "path";', 'import { join, dirname, resolve, relative, isAbsolute } from "path";', "path helpers");
main = replaceText(main, 'import crypto from "crypto";', 'import crypto from "crypto";\nimport { Worker } from "worker_threads";', "worker_threads");

main = replaceRx(main, /const PROVIDERS = \{[\s\S]*?\n\};\n\nfunction labelEnv/,
`const PROVIDERS = {
  none: { label: "Sem IA (análise local)", category: "local", backend: null, endpoint: "", model: "", keyOptional: true },
  ollama: { label: "Ollama (local)", category: "local", backend: "ollama", endpoint: "http://localhost:11434", model: "", keyOptional: true, modelSource: "ollama" },
  lmstudio: { label: "LM Studio", category: "local", backend: "openai", endpoint: "http://localhost:1234/v1", model: "", keyOptional: true, modelSource: "openai" },
  vllm: { label: "vLLM", category: "local", backend: "openai", endpoint: "http://localhost:8000/v1", model: "", keyOptional: true, modelSource: "openai" },
  opencode_zen: { label: "OpenCode Zen (free + pago)", category: "free", backend: "openai", endpoint: "https://opencode.ai/zen/v1", model: "big-pickle", modelSource: "openai", modelsPublic: true },
  gemini: { label: "Google Gemini", category: "free", backend: "gemini", endpoint: "https://generativelanguage.googleapis.com", model: "", modelSource: "gemini" },
  nvidia: { label: "NVIDIA NIM", category: "free", backend: "openai", endpoint: "https://integrate.api.nvidia.com/v1", model: "", modelSource: "openai" },
  openrouter: { label: "OpenRouter", category: "free", backend: "openai", endpoint: "https://openrouter.ai/api/v1", model: "", modelSource: "openai" },
  groq: { label: "Groq", category: "free", backend: "openai", endpoint: "https://api.groq.com/openai/v1", model: "", modelSource: "openai" },
  opencode_go: { label: "OpenCode Go", category: "paid", backend: "openai", endpoint: "https://opencode.ai/zen/go/v1", model: "glm-5.3-flash", modelSource: "openai", modelsPublic: true },
  openai: { label: "OpenAI", category: "paid", backend: "openai", endpoint: "https://api.openai.com/v1", model: "", modelSource: "openai" },
  anthropic: { label: "Anthropic / Claude", category: "paid", backend: "claude", endpoint: "https://api.anthropic.com", model: "", modelSource: "anthropic" },
  deepseek: { label: "DeepSeek", category: "paid", backend: "deepseek", endpoint: "https://api.deepseek.com", model: "deepseek-chat", modelSource: "openai" },
  kimi: { label: "Kimi", category: "paid", backend: "kimi", endpoint: "https://api.moonshot.cn/v1", model: "", modelSource: "openai" },
  mistral: { label: "Mistral", category: "paid", backend: "openai", endpoint: "https://api.mistral.ai/v1", model: "", modelSource: "openai" },
  azure: { label: "Azure OpenAI", category: "paid", backend: "azure", endpoint: "", model: "", modelSource: "manual" },
  bedrock: { label: "AWS Bedrock", category: "paid", backend: "bedrock", endpoint: "", model: "", modelSource: "manual" },
  custom: { label: "Custom (OpenAI-compatible)", category: "advanced", backend: "openai", endpoint: "", model: "", keyOptional: true, modelSource: "openai" },
};

function prettyModelName(id) {
  return String(id || "").replace(/^models\\//, "").replace(/[:/_-]+/g, " ").replace(/\\b\\w/g, (c) => c.toUpperCase()).replace(/\\bGpt\\b/g, "GPT").replace(/\\bGlm\\b/g, "GLM").replace(/\\bAi\\b/g, "AI").replace(/\\bMimo\\b/g, "MiMo").trim();
}
function profileFromParameterSize(value) {
  const match = String(value || "").match(/([\\d.]+)\\s*B/i);
  if (!match) return null;
  const size = Number(match[1]);
  if (!Number.isFinite(size)) return null;
  if (size <= 12) return "fast";
  if (size <= 40) return "balanced";
  return "quality";
}
function modelProfile(id, metadata = {}) {
  const fromSize = profileFromParameterSize(metadata?.details?.parameter_size || metadata?.parameter_size);
  if (fromSize) return fromSize;
  const name = String(id || "").toLowerCase();
  if (/flash|lightning|nano|mini|small|haiku|spark|8b|7b|3b|1b/.test(name)) return "fast";
  if (/pro|max|opus|ultra|large|70b|120b|122b|397b|405b|550b|675b|gpt-5\\.6-sol/.test(name)) return "quality";
  return "balanced";
}
function openCodeGraphifyCompatible(provider, id) {
  const name = String(id || "").toLowerCase();
  if (provider === "opencode_zen") {
    if (/^(claude-|gemini-|gpt-|qwen)/.test(name)) return false;
    if (/^muse-/.test(name)) return false;
    return /^(big-pickle|deepseek-|glm-|kimi-|minimax-|mimo-|hy3|nemotron-|ling-|laguna-)/.test(name) || /-free$/.test(name);
  }
  if (provider === "opencode_go") {
    if (/^(gpt-|grok-|minimax-|muse-|qwen)/.test(name)) return false;
    return /^(glm-|kimi-|longcat-|deepseek-|mimo-|hy3)/.test(name);
  }
  return true;
}
function modelTier(provider, id) {
  const name = String(id || "").toLowerCase();
  if (provider === "opencode_zen" && (name === "big-pickle" || /-free$/.test(name))) return "free";
  if (provider === "openrouter" && /:free$/.test(name)) return "free";
  if (PROVIDERS[provider]?.category === "free") return "free-tier";
  if (PROVIDERS[provider]?.category === "local") return "local";
  return "paid";
}
async function fetchProviderModels(config = {}) {
  const provider = config.provider;
  const p = PROVIDERS[provider];
  if (!p) return { ok: false, models: [], message: "Provedor desconhecido" };
  if (provider === "none") return { ok: true, models: [], source: "none" };
  const persisted = loadConfigFile();
  const suppliedKey = typeof config.apiKey === "string" ? config.apiKey.trim() : "";
  const key = suppliedKey || (persisted.provider === provider ? await resolveProviderKey(persisted) : null);
  const endpoint = String(config.endpoint || p.endpoint || "").replace(/\\\/$/, "");
  try {
    if (provider === "ollama") {
      const r = await fetch((endpoint || "http://localhost:11434") + "/api/tags", { signal: AbortSignal.timeout(15000) });
      if (!r.ok) return { ok: false, models: [], message: "Ollama HTTP " + r.status };
      const payload = await r.json();
      const models = (payload.models || []).map((m) => ({ id: m.name || m.model, label: m.name || m.model, profile: modelProfile(m.name || m.model, m), tier: "local", compatible: true, meta: m?.details?.parameter_size || "" })).filter((m) => m.id);
      return { ok: true, models, source: "ollama", refreshedAt: new Date().toISOString() };
    }
    if (provider === "gemini") {
      if (!key) return { ok: false, models: [], message: "Informe a chave Gemini para carregar os modelos" };
      const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?key=" + encodeURIComponent(key), { signal: AbortSignal.timeout(20000) });
      if (!r.ok) return { ok: false, models: [], message: "Gemini HTTP " + r.status };
      const payload = await r.json();
      const models = (payload.models || []).filter((m) => !Array.isArray(m.supportedGenerationMethods) || m.supportedGenerationMethods.includes("generateContent")).map((m) => { const id = String(m.name || "").replace(/^models\\//, ""); return { id, label: m.displayName || prettyModelName(id), profile: modelProfile(id, m), tier: "free-tier", compatible: true }; }).filter((m) => m.id);
      return { ok: true, models, source: "gemini", refreshedAt: new Date().toISOString() };
    }
    if (provider === "anthropic") {
      if (!key) return { ok: false, models: [], message: "Informe a chave Anthropic para carregar os modelos" };
      const base = endpoint || "https://api.anthropic.com";
      const r = await fetch(base + "/v1/models", { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) return { ok: false, models: [], message: "Anthropic HTTP " + r.status };
      const payload = await r.json();
      const models = (payload.data || []).map((m) => ({ id: m.id, label: m.display_name || prettyModelName(m.id), profile: modelProfile(m.id, m), tier: "paid", compatible: true })).filter((m) => m.id);
      return { ok: true, models, source: "anthropic", refreshedAt: new Date().toISOString() };
    }
    if (p.modelSource === "manual") {
      const existing = config.model || (persisted.provider === provider ? persisted.model : "");
      return { ok: true, models: existing ? [{ id: existing, label: prettyModelName(existing), profile: "balanced", tier: "paid", compatible: true }] : [], source: "saved", manual: true, message: existing ? "Modelo salvo carregado" : "Este provedor precisa de um deployment/modelo configurado externamente" };
    }
    if (!endpoint) return { ok: false, models: [], message: "Informe o endpoint" };
    if (!p.keyOptional && !p.modelsPublic && !key) return { ok: false, models: [], message: "Informe a chave de API para carregar os modelos" };
    const headers = key ? { Authorization: "Bearer " + key } : {};
    const r = await fetch(endpoint + "/models", { headers, signal: AbortSignal.timeout(20000) });
    if (!r.ok) { const auth = [401, 403].includes(r.status) ? " — chave necessária ou inválida" : ""; return { ok: false, models: [], message: "Catálogo HTTP " + r.status + auth }; }
    const payload = await r.json();
    const data = Array.isArray(payload?.data) ? payload.data : (Array.isArray(payload?.models) ? payload.models : []);
    const models = data.map((m) => { const id = String(m?.id ?? m?.name ?? m?.model ?? ""); return { id, label: m?.display_name || m?.displayName || m?.label || prettyModelName(id), profile: modelProfile(id, m), tier: modelTier(provider, id), compatible: openCodeGraphifyCompatible(provider, id) }; }).filter((m) => m.id);
    models.sort((a, b) => { const freeA = a.tier === "free" ? 0 : 1, freeB = b.tier === "free" ? 0 : 1; return freeA - freeB || a.label.localeCompare(b.label, "pt-BR", { sensitivity: "base" }); });
    return { ok: true, models, source: "live", refreshedAt: new Date().toISOString() };
  } catch (e) { return { ok: false, models: [], message: "Não foi possível carregar modelos: " + e.message }; }
}

function labelEnv`, "providers dinâmicos + OpenCode + Mistral");

main = replaceText(main, "// ── Graphify detection / capabilities ─────────────────────────",
`// ── graph.json fallback viewer ─────────────────────────────────
function isProjectInsideWorkspace(projectPath) {
  const cfg = loadConfigFile();
  if (!cfg.workspace || !projectPath) return false;
  const workspace = resolve(cfg.workspace);
  const project = resolve(projectPath);
  const rel = relative(workspace, project);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
function loadGraphData(projectPath) {
  return new Promise((resolvePromise, reject) => {
    if (!isProjectInsideWorkspace(projectPath)) { reject(new Error("Projeto fora do workspace configurado")); return; }
    const graphPath = graphJsonPath(projectPath);
    if (!existsSync(graphPath)) { reject(new Error("graph.json não encontrado")); return; }
    const worker = new Worker(join(__dirname, "public", "graph-data-worker.cjs"), { workerData: { graphPath, projectPath } });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error("Tempo excedido ao preparar o grafo grande")); }, 120000);
    worker.once("message", (message) => { clearTimeout(timer); worker.terminate(); if (message?.ok) resolvePromise(message); else reject(new Error(message?.error || "Falha ao preparar graph.json")); });
    worker.once("error", (error) => { clearTimeout(timer); reject(error); });
  });
}

// ── Graphify detection / capabilities ─────────────────────────`, "fallback graph.json worker");

main = replaceText(main,
`  ipcMain.handle("workspace:scan", async (_e, root) => {
    if (!root || !existsSync(root)) return { root: null, projects: [] };
    return scanWorkspace(root);
  });`,
`  ipcMain.handle("workspace:scan", async (_e, root) => {
    if (!root || !existsSync(root)) return { root: null, projects: [] };
    return scanWorkspace(root);
  });

  ipcMain.handle("graph:data", async (_e, projectPath) => {
    try { return await loadGraphData(projectPath); }
    catch (e) { return { ok: false, error: e.message }; }
  });`, "IPC graph:data");
main = replaceText(main, '  ipcMain.handle("provider:test", async (_e, config) => {', '  ipcMain.handle("provider:models", async (_e, config) => fetchProviderModels(config || {}));\n\n  ipcMain.handle("provider:test", async (_e, config) => {', "IPC provider:models");
main = replaceText(main, '["openai", "deepseek", "kimi", "nvidia", "openrouter", "groq", "lmstudio", "vllm", "custom"]', '["openai", "deepseek", "kimi", "mistral", "nvidia", "openrouter", "groq", "lmstudio", "vllm", "opencode_zen", "opencode_go", "custom"]', "provider:test openai-like list");
main = replaceText(main, '["openai", "deepseek", "kimi", "nvidia", "openrouter", "groq"]', '["openai", "deepseek", "kimi", "mistral", "nvidia", "openrouter", "groq", "opencode_zen", "opencode_go"]', "provider:test key-required list");
main = replaceRx(main, /canLabel: \(provider \|\| cfg\.provider \|\| "none"\) !== "none" &&\n\s*\(Boolean\(providerKey\) \|\| \(provider \|\| cfg\.provider\) === "ollama"\),/, `canLabel: (provider || cfg.provider || "none") !== "none" &&\n        (Boolean(providerKey) || Boolean(PROVIDERS[provider || cfg.provider || "none"]?.keyOptional)),`, "canLabel keyOptional");
main = replaceText(main, '    if (operation === "relabel" && (!providerKey || labelCfg.provider === "none"))\n      return { jobId: null, error: "Informe um provedor de IA com chave para melhorar nomes" };', '    if (operation === "relabel" && !labelCfg.canLabel)\n      return { jobId: null, error: "Configure um provedor de IA disponível para melhorar nomes" };', "relabel local/keyOptional");
write("main.js", main);

let preload = read("preload.cjs");
preload = replaceText(preload, '  testProvider: (config) => ipcRenderer.invoke("provider:test", config),', '  listModels: (config) => ipcRenderer.invoke("provider:models", config),\n\n  testProvider: (config) => ipcRenderer.invoke("provider:test", config),', "preload listModels");
preload = replaceText(preload, '  scanWorkspace: (root) => ipcRenderer.invoke("workspace:scan", root),', '  scanWorkspace: (root) => ipcRenderer.invoke("workspace:scan", root),\n\n  loadGraphData: (projectPath) => ipcRenderer.invoke("graph:data", projectPath),', "preload loadGraphData");
write("preload.cjs", preload);

let html = read("public/index.html");
html = replaceText(html, '.provider-fields input,.provider-fields select{width:100%}', '.provider-fields input,.provider-fields select{width:100%}\n.model-picker{display:flex;gap:6px;align-items:center}.model-picker select{flex:1;min-width:0}\n.model-refresh{padding:8px 10px;white-space:nowrap}.model-meta{font-size:10px;color:#8b949e;margin:6px 0 2px;min-height:14px}\n.model-profiles{display:flex;gap:5px;flex-wrap:wrap;margin-top:6px}.profile-btn{font-size:10px;padding:4px 7px;border-radius:999px;background:#161b22;border:1px solid #30363d;color:#8b949e;cursor:pointer}.profile-btn:hover{color:#f0f6fc;border-color:#58a6ff}', "model picker CSS");
html = replaceRx(html, /<select id="providerSelect">[\s\S]*?<\/select>\n\s*<div class="provider-fields hidden"/, `<select id="providerSelect">
        <optgroup label="Local / sem custo"><option value="none">Sem IA (análise local)</option><option value="ollama">Ollama (local)</option><option value="lmstudio">LM Studio</option><option value="vllm">vLLM</option></optgroup>
        <optgroup label="Grátis / free tier"><option value="opencode_zen">OpenCode Zen (free + pago)</option><option value="gemini">Google Gemini</option><option value="nvidia">NVIDIA NIM</option><option value="openrouter">OpenRouter</option><option value="groq">Groq</option></optgroup>
        <optgroup label="Pagos / assinatura"><option value="opencode_go">OpenCode Go</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic / Claude</option><option value="deepseek">DeepSeek</option><option value="kimi">Kimi</option><option value="mistral">Mistral</option><option value="azure">Azure OpenAI</option><option value="bedrock">AWS Bedrock</option></optgroup>
        <optgroup label="Avançado"><option value="custom">Custom (OpenAI-compatible)</option></optgroup>
      </select>
      <div class="provider-fields hidden"`, "provider groups setup");
html = replaceText(html, `        <div class="grid2" style="margin-bottom:8px">
          <input id="endpointInput" placeholder="endpoint">
          <input id="modelInput" placeholder="modelo">
        </div>`, `        <div class="grid2" style="margin-bottom:8px">
          <input id="endpointInput" placeholder="endpoint (preenchido automaticamente)">
          <div class="model-picker"><select id="modelSelect"><option value="">Selecione um modelo</option></select><button class="btn sec model-refresh" type="button" id="btnRefreshModels" title="Atualizar modelos">↻</button></div>
        </div>
        <div class="model-meta" id="modelMeta"></div><div class="model-profiles" id="modelProfiles"></div>`, "setup model select");
html = replaceText(html, '<script>\nconst PRESETS = {', '<script src="./graph-json-viewer.js"></script>\n<script>\nconst PRESETS = {', "load graph-json-viewer");
html = replaceRx(html, /const PRESETS = \{[\s\S]*?\n\};\nconst PROVIDER_OPTIONS = \[[\s\S]*?\n\];/, `const PRESETS = {
  none:{endpoint:"",model:""}, ollama:{endpoint:"http://localhost:11434",model:""}, lmstudio:{endpoint:"http://localhost:1234/v1",model:""}, vllm:{endpoint:"http://localhost:8000/v1",model:""},
  opencode_zen:{endpoint:"https://opencode.ai/zen/v1",model:"big-pickle"}, gemini:{endpoint:"https://generativelanguage.googleapis.com",model:""}, nvidia:{endpoint:"https://integrate.api.nvidia.com/v1",model:""}, openrouter:{endpoint:"https://openrouter.ai/api/v1",model:""}, groq:{endpoint:"https://api.groq.com/openai/v1",model:""},
  opencode_go:{endpoint:"https://opencode.ai/zen/go/v1",model:"glm-5.3-flash"}, openai:{endpoint:"https://api.openai.com/v1",model:""}, anthropic:{endpoint:"https://api.anthropic.com",model:""}, deepseek:{endpoint:"https://api.deepseek.com",model:"deepseek-chat"}, kimi:{endpoint:"https://api.moonshot.cn/v1",model:""}, mistral:{endpoint:"https://api.mistral.ai/v1",model:""}, azure:{endpoint:"",model:""}, bedrock:{endpoint:"",model:""}, custom:{endpoint:"",model:""}
};
const PROVIDER_OPTIONS = [
  {group:"Local / sem custo",items:[["none","Sem IA (análise local)"],["ollama","Ollama (local)"],["lmstudio","LM Studio"],["vllm","vLLM"]]},
  {group:"Grátis / free tier",items:[["opencode_zen","OpenCode Zen (free + pago)"],["gemini","Google Gemini"],["nvidia","NVIDIA NIM"],["openrouter","OpenRouter"],["groq","Groq"]]},
  {group:"Pagos / assinatura",items:[["opencode_go","OpenCode Go"],["openai","OpenAI"],["anthropic","Anthropic / Claude"],["deepseek","DeepSeek"],["kimi","Kimi"],["mistral","Mistral"],["azure","Azure OpenAI"],["bedrock","AWS Bedrock"]]},
  {group:"Avançado",items:[["custom","Custom (OpenAI-compatible)"]]}
];`, "provider presets + groups");
html = replaceText(html, 'const state = { workspace:null, projects:[], selected:null, activeJobId:null, activeOp:null, graphify:null, safeAvailable:true, config:{ encryptionAvailable:true } };', 'const state = { workspace:null, projects:[], selected:null, activeJobId:null, activeOp:null, graphify:null, safeAvailable:true, config:{ encryptionAvailable:true }, modelCache:new Map(), modelRequest:0, jsonViewer:null };', "state model cache");
html = replaceRx(html, /function buildProviderSelect\(\)\{[\s\S]*?\n\}\n\nfunction renderUpdateStatus/, `function buildProviderSelect(){
  const sel=$("providerSelect"); sel.innerHTML=""; PROVIDER_OPTIONS.forEach(g=>{const og=document.createElement("optgroup");og.label=g.group;g.items.forEach(([v,l])=>{const o=document.createElement("option");o.value=v;o.textContent=l;og.appendChild(o)});sel.appendChild(og)}); sel.value=(state.config&&state.config.provider)||"none";sel.onchange=onProviderChange;onProviderChange();
}
function modelValue(id){return ($(id)&&$(id).value)||"";}
function renderProfileButtons(container,select,models){container.innerHTML="";[["fast","⚡ Rápido"],["balanced","⚖ Médio"],["quality","🎯 Pesado / preciso"]].forEach(([profile,label])=>{const candidate=models.find(m=>m.compatible!==false&&m.profile===profile);if(!candidate)return;const b=document.createElement("button");b.type="button";b.className="profile-btn";b.textContent=label;b.title=candidate.label;b.onclick=()=>{select.value=candidate.id;select.dispatchEvent(new Event("change"));};container.appendChild(b);});}
function populateModelSelect(select,models,preferred){select.innerHTML="";const compatible=models.filter(m=>m.compatible!==false),incompatible=models.filter(m=>m.compatible===false);const add=(label,items,disabled=false)=>{if(!items.length)return;const g=document.createElement("optgroup");g.label=label;items.forEach(m=>{const o=document.createElement("option");o.value=m.id;o.textContent=m.label||m.id;o.disabled=disabled;g.appendChild(o)});select.appendChild(g)};add("Modelos disponíveis",compatible);add("Disponíveis no provedor · incompatíveis com Graphify",incompatible,true);if(preferred&&!compatible.some(m=>m.id===preferred)){const o=document.createElement("option");o.value=preferred;o.textContent=preferred+" · salvo/não listado";select.insertBefore(o,select.firstChild)}if(!select.options.length){const o=document.createElement("option");o.value="";o.textContent="Nenhum modelo listado";select.appendChild(o)}const target=preferred&&[...select.options].some(o=>o.value===preferred&&!o.disabled)?preferred:(compatible[0]?.id||preferred||"");select.value=target;}
async function refreshModels({provider,endpoint,apiKey,select,meta,profiles,preferred,force=false}){if(!provider||provider==="none"){select.innerHTML='<option value="">Sem IA</option>';meta.textContent="";profiles.innerHTML="";return;}const cacheKey=provider+"|"+endpoint,cached=state.modelCache.get(cacheKey);if(!force&&cached&&Date.now()-cached.at<300000){populateModelSelect(select,cached.models,preferred);renderProfileButtons(profiles,select,cached.models);meta.textContent="catálogo em cache · "+cached.models.length+" modelos";return;}const request=++state.modelRequest;select.innerHTML='<option value="">Carregando modelos...</option>';select.disabled=true;meta.textContent="atualizando catálogo...";try{const res=await api.listModels({provider,endpoint,apiKey});if(request!==state.modelRequest)return;const models=Array.isArray(res&&res.models)?res.models:[];if(!res||!res.ok){populateModelSelect(select,[],preferred);meta.textContent=(res&&res.message)||"Não foi possível carregar modelos";renderProfileButtons(profiles,select,[]);return;}state.modelCache.set(cacheKey,{at:Date.now(),models});populateModelSelect(select,models,preferred);renderProfileButtons(profiles,select,models);const free=models.filter(m=>m.tier==="free").length;meta.textContent=(res.manual?"catálogo automático indisponível · ":"atualizado agora · ")+models.length+" modelos"+(free?(" · "+free+" grátis"):"");}catch(e){populateModelSelect(select,[],preferred);meta.textContent="Falha ao atualizar modelos: "+e.message;renderProfileButtons(profiles,select,[]);}finally{select.disabled=false;}}

function renderUpdateStatus`, "dynamic model picker helpers");
html = replaceRx(html, /function onProviderChange\(\)\{[\s\S]*?\n\}\nfunction applySecurityState/, `async function onProviderChange(){const p=$("providerSelect").value,fields=$("providerFields");if(p==="none"){fields.classList.add("hidden");return;}fields.classList.remove("hidden");const cfg=state.config||{},sameProvider=cfg.provider===p,endpoint=sameProvider?(cfg.endpoint||PRESETS[p]?.endpoint||""):(PRESETS[p]?.endpoint||""),preferred=sameProvider?(cfg.model||PRESETS[p]?.model||""):(PRESETS[p]?.model||"");$("endpointInput").value=endpoint;await refreshModels({provider:p,endpoint,apiKey:$("keyInput").value,select:$("modelSelect"),meta:$("modelMeta"),profiles:$("modelProfiles"),preferred});}
function applySecurityState`, "setup provider change loads models");
html = replaceText(html, '  $("btnTest").onclick = testConnection;', '  $("btnTest").onclick = testConnection;\n  $("btnRefreshModels").onclick = ()=>refreshModels({provider:$("providerSelect").value,endpoint:$("endpointInput").value.trim(),apiKey:$("keyInput").value,select:$("modelSelect"),meta:$("modelMeta"),profiles:$("modelProfiles"),preferred:modelValue("modelSelect"),force:true});\n  $("keyInput").addEventListener("change", ()=>$("btnRefreshModels").click());', "setup refresh models button");
html = replaceText(html, '    const model = p==="none" ? "" : $("modelInput").value.trim();', '    const model = p==="none" ? "" : modelValue("modelSelect");', "save selected model");
html = replaceText(html, '    const res = await api.testProvider({ provider:p, endpoint:$("endpointInput").value.trim(), model:$("modelInput").value.trim(), apiKey:$("keyInput").value });', '    const res = await api.testProvider({ provider:p, endpoint:$("endpointInput").value.trim(), model:modelValue("modelSelect"), apiKey:$("keyInput").value });', "test selected model");
html = replaceText(html, `  if ((p.status==="graph-with-ia" || p.status==="graph-no-ia") && !p.graphUrl){
    c.innerHTML = '<div class="center-msg"><div class="big">Grafo encontrado, mas a visualização HTML não existe</div><div class="small">Os dados graph.json foram detectados. Gere/atualize a visualização com o Graphify.</div><button class="btn" style="margin-top:14px" id="updateGraphBtn">Atualizar grafo</button></div>';
    $("updateGraphBtn").onclick = ()=>runOp(p,"update");
    return;
  }`, `  if ((p.status==="graph-with-ia" || p.status==="graph-no-ia") && !p.graphUrl && p.hasGraphJson){openJsonGraph(p);return;}`, "large graph JSON fallback");
html = replaceText(html, '  wv.addEventListener("did-fail-load", (e)=>{ ov.innerHTML=\'<div class="overlay-msg" style="color:#f85149">Falha ao carregar: \'+ (e.errorDescription||"erro") +\'</div>\'; });', '  wv.addEventListener("did-fail-load", (e)=>{ if(p.hasGraphJson){openJsonGraph(p);return;} ov.innerHTML=\'<div class="overlay-msg" style="color:#f85149">Falha ao carregar: \'+ (e.errorDescription||"erro") +\'</div>\'; });', "HTML fail -> JSON fallback");
html = replaceText(html, `  c.appendChild(wv);
}

// ── Run graphify ──`, `  c.appendChild(wv);
}
async function openJsonGraph(p){const c=$("center");c.innerHTML='<div class="loading-ov"><div class="spinner"></div><div class="overlay-msg">Preparando visualização do graph.json...</div></div>';try{const data=await api.loadGraphData(p.path);if(!data||!data.ok)throw new Error((data&&data.error)||"Falha ao ler graph.json");if(!window.GraphJsonViewer)throw new Error("Visualizador interno não carregado");if(state.jsonViewer&&state.jsonViewer.destroy)state.jsonViewer.destroy();state.jsonViewer=window.GraphJsonViewer.mount(c,data);}catch(e){c.innerHTML='<div class="center-msg"><div class="big">Não foi possível visualizar o graph.json</div><div class="small"></div><button class="btn" style="margin-top:14px" id="updateGraphBtn">Atualizar grafo</button></div>';c.querySelector(".small").textContent=e.message;$("updateGraphBtn").onclick=()=>runOp(p,"update");}}

// ── Run graphify ──`, "openJsonGraph");
html = replaceRx(html, /function openConfigModal\(\)\{[\s\S]*?\n\}\n\n\/\/ ── Prompt modal/, `function openConfigModal(){
  const cfg=state.config||{};const body=\`<h3>Configurar provedor de IA</h3><p>Escolha o provedor e depois o modelo pela lista atualizada automaticamente. Para Ollama, o app lê os modelos já instalados na sua máquina.</p><select id="mProvider" style="width:100%"></select><div id="mFields" style="margin-top:10px"><input id="mEndpoint" placeholder="endpoint (preenchido automaticamente)" style="width:100%;margin-bottom:8px"><div class="model-picker"><select id="mModel"><option value="">Selecione um modelo</option></select><button class="btn sec model-refresh" type="button" id="mRefresh" title="Atualizar modelos">↻</button></div><div class="model-meta" id="mMeta"></div><div class="model-profiles" id="mProfiles"></div><input id="mKey" type="password" placeholder="chave de API" style="width:100%;margin-top:8px"><div class="opt-row" style="margin-top:8px"><input type="checkbox" id="mSession"><label for="mSession" style="margin:0">usar esta chave apenas durante a sessão</label></div><div style="margin-top:8px;font-size:11px;color:#8b949e">A chave não é exibida nem salva em texto puro.</div></div><div class="warn-note hidden" id="mWarn"></div><div class="actions" style="justify-content:flex-start;margin-top:14px"><button class="btn sec" id="mTest">Testar</button><span id="mTestR" style="font-size:11px;align-self:center"></span><button class="btn" id="mSave" style="margin-left:auto">Salvar</button></div>\`;$("modalBody").innerHTML=body;$("modal").classList.add("visible");const sel=$("mProvider");PROVIDER_OPTIONS.forEach(g=>{const og=document.createElement("optgroup");og.label=g.group;g.items.forEach(([v,l])=>{const o=document.createElement("option");o.value=v;o.textContent=l;og.appendChild(o)});sel.appendChild(og)});sel.value=cfg.provider||"none";const sync=async(force=false)=>{const p=sel.value,sameProvider=cfg.provider===p;$("mFields").style.display=p==="none"?"none":"block";if(p==="none")return;const endpoint=sameProvider?(cfg.endpoint||PRESETS[p]?.endpoint||""):(PRESETS[p]?.endpoint||""),preferred=sameProvider?(cfg.model||PRESETS[p]?.model||""):(PRESETS[p]?.model||"");$("mEndpoint").value=endpoint;await refreshModels({provider:p,endpoint,apiKey:$("mKey").value,select:$("mModel"),meta:$("mMeta"),profiles:$("mProfiles"),preferred,force});};sel.onchange=()=>sync(false);sync(false);$("mRefresh").onclick=()=>sync(true);$("mKey").addEventListener("change",()=>$("mRefresh").click());applySecurityState($("mSession"),$("mWarn"),state.config||{encryptionAvailable:true,sessionOnly:false});$("mTest").onclick=async()=>{const r=await api.testProvider({provider:sel.value,endpoint:$("mEndpoint").value.trim(),model:$("mModel").value,apiKey:$("mKey").value});$("mTestR").textContent=r.ok?"✓ "+(r.message||""):"✗ "+(r.message||"");$("mTestR").style.color=r.ok?"#3fb950":"#f85149";};$("mSave").onclick=async()=>{const p=sel.value,sessionOnly=!state.config.encryptionAvailable||$("mSession").checked;const res=await api.saveConfig({workspace:state.workspace,provider:p,endpoint:p==="none"?"":$("mEndpoint").value.trim(),model:p==="none"?"":$("mModel").value,apiKey:p==="none"?"":$("mKey").value,sessionOnly});if(!res||!res.ok){alert("Não foi possível salvar: "+((res&&res.error)||"erro"));return;}state.config=res;$("modal").classList.remove("visible");};
}

// ── Prompt modal`, "config modal model picker");
html = replaceText(html, 'O Graph Explorer abre o arquivo <code>graphify-out/graph.html</code> gerado.', 'O Graph Explorer abre <code>graphify-out/graph.html</code> quando disponível; em projetos grandes, quando o Graphify não gera HTML, o app visualiza diretamente o <code>graph.json</code> em modo otimizado por comunidades.', "prompt explains large graph fallback");
write("public/index.html", html);

for (const file of ["package.json", "package-lock.json"]) {
  const data = JSON.parse(read(file)); data.version = "1.1.5"; if (data.packages?.[""]) data.packages[""].version = "1.1.5"; write(file, JSON.stringify(data, null, 2) + "\n");
}
console.log("Graph Explorer v1.1.5 feature patch aplicado.");
