import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  safeStorage,
  Menu,
} from "electron";
import electronUpdater from "electron-updater";
import { promises as fsp, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname, resolve, relative, isAbsolute } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { spawn } from "child_process";
import crypto from "crypto";
import { Worker } from "worker_threads";

const { autoUpdater } = electronUpdater;

const __dirname = dirname(fileURLToPath(import.meta.url));
// Em builds empacotados (portable/instalador), __dirname é um diretório temporário.
// userData garante persistência real; GE_CONFIG_DIR (QA) continua com prioridade.
const CONFIG_DIR = process.env.GE_CONFIG_DIR || app.getPath("userData");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

let mainWindow = null;
let sessionApiKey = null;
let sessionProvider = null;
let encryptionAvailable = false;
let graphifyCaps = null;
let activeJob = null;
let updaterInitialized = false;
let updateDownloaded = false;
let updateStatus = {
  state: "idle",
  currentVersion: app.getVersion(),
  availableVersion: null,
  percent: null,
  supported: false,
  message: "",
};

function publishUpdateStatus(patch = {}) {
  updateStatus = { ...updateStatus, ...patch, currentVersion: app.getVersion() };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("update:status", updateStatus);
  }
}

async function checkForAppUpdates(manual = false) {
  if (!updateStatus.supported) return updateStatus;
  publishUpdateStatus({ state: "checking", message: manual ? "Verificando atualização..." : "" });
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    publishUpdateStatus({ state: "error", message: "Falha ao verificar atualização: " + error.message });
  }
  return updateStatus;
}

function initializeAutoUpdater() {
  if (updaterInitialized) return;
  updaterInitialized = true;

  const isPortable = Boolean(process.env.PORTABLE_EXECUTABLE_FILE || process.env.PORTABLE_EXECUTABLE_DIR);
  const supported = app.isPackaged && process.platform === "win32" && !isPortable;
  publishUpdateStatus({
    supported,
    state: supported ? "idle" : "unsupported",
    message: supported ? "" : isPortable ? "Atualização automática requer o instalador Setup" : "Atualização automática ativa apenas no app instalado",
  });
  if (!supported) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.on("checking-for-update", () => publishUpdateStatus({ state: "checking", message: "Verificando atualização..." }));
  autoUpdater.on("update-available", (info) => publishUpdateStatus({
    state: "available",
    availableVersion: info.version,
    percent: 0,
    message: `Baixando v${info.version} em segundo plano...`,
  }));
  autoUpdater.on("update-not-available", () => publishUpdateStatus({
    state: "current",
    availableVersion: null,
    percent: null,
    message: "Aplicativo atualizado",
  }));
  autoUpdater.on("download-progress", (progress) => publishUpdateStatus({
    state: "downloading",
    percent: Math.round(progress.percent),
    message: `Baixando atualização: ${Math.round(progress.percent)}%`,
  }));
  autoUpdater.on("update-downloaded", (info) => {
    updateDownloaded = true;
    publishUpdateStatus({
      state: "downloaded",
      availableVersion: info.version,
      percent: 100,
      message: `v${info.version} pronta. Feche o app para instalar.`,
    });
  });
  autoUpdater.on("error", (error) => publishUpdateStatus({
    state: "error",
    message: "Falha na atualização: " + error.message,
  }));

  setTimeout(() => checkForAppUpdates(false), 2500);
}

// ── Safe storage (só após app.whenReady) ──────────────────────
async function detectEncryption() {
  try {
    if (typeof safeStorage.isAsyncEncryptionAvailable === "function") {
      return await safeStorage.isAsyncEncryptionAvailable();
    }
    return safeStorage.isEncryptionAvailable();
  } catch (e) {
    console.error("[safeStorage] detection failed:", e.message);
    return false;
  }
}

// ── Config helpers ────────────────────────────────────────────
function loadConfigFile() {
  try {
    if (existsSync(CONFIG_PATH)) return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  } catch {}
  return {};
}
function saveSanitizedConfig(cfg) {
  const { apiKey, ...safe } = cfg;
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(safe, null, 2));
}
async function resolveProviderKey(config) {
  if (sessionApiKey && config?.provider === sessionProvider) return sessionApiKey;
  if (!config.encryptedCredential) return null;
  const encrypted = Buffer.from(config.encryptedCredential, "base64");
  try {
    if (typeof safeStorage.decryptStringAsync === "function") {
      const dec = await safeStorage.decryptStringAsync(encrypted);
      return dec && typeof dec.result === "string" ? dec.result : dec;
    }
    return safeStorage.decryptString(encrypted);
  } catch {
    return null;
  }
}

// ── Providers ─────────────────────────────────────────────────
const PROVIDERS = {
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
  return String(id || "").replace(/^models\//, "").replace(/[:/_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bGpt\b/g, "GPT").replace(/\bGlm\b/g, "GLM").replace(/\bAi\b/g, "AI").replace(/\bMimo\b/g, "MiMo").trim();
}
function profileFromParameterSize(value) {
  const match = String(value || "").match(/([\d.]+)\s*B/i);
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
  if (/pro|max|opus|ultra|large|70b|120b|122b|397b|405b|550b|675b|gpt-5\.6-sol/.test(name)) return "quality";
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
  const endpoint = String(config.endpoint || p.endpoint || "").replace(/\/$/, "");
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
      const models = (payload.models || []).filter((m) => !Array.isArray(m.supportedGenerationMethods) || m.supportedGenerationMethods.includes("generateContent")).map((m) => { const id = String(m.name || "").replace(/^models\//, ""); return { id, label: m.displayName || prettyModelName(id), profile: modelProfile(id, m), tier: "free-tier", compatible: true }; }).filter((m) => m.id);
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

function labelEnv(provider, config, providerKey) {
  const env = { ...process.env };
  const p = PROVIDERS[provider];
  if (!p || !p.backend) return env;
  if (p.backend === "openai") {
    env.OPENAI_API_KEY = providerKey || "";
    env.OPENAI_BASE_URL = config.endpoint || "";
    env.OPENAI_MODEL = config.model || "";
  } else if (p.backend === "claude") {
    env.ANTHROPIC_API_KEY = providerKey || "";
    if (config.endpoint) env.ANTHROPIC_BASE_URL = config.endpoint;
  } else if (p.backend === "gemini") {
    env.GEMINI_API_KEY = providerKey || "";
  } else if (p.backend === "deepseek") {
    env.DEEPSEEK_API_KEY = providerKey || "";
    if (config.endpoint) env.DEEPSEEK_BASE_URL = config.endpoint;
  } else if (p.backend === "kimi") {
    env.KIMI_API_KEY = providerKey || "";
    if (config.endpoint) env.KIMI_BASE_URL = config.endpoint;
  } else if (p.backend === "ollama") {
    if (config.endpoint) { env.OLLAMA_HOST = config.endpoint; env.OPENAI_BASE_URL = config.endpoint; }
  } else if (p.backend === "azure") {
    env.AZURE_OPENAI_API_KEY = providerKey || "";
    if (config.endpoint) env.AZURE_OPENAI_ENDPOINT = config.endpoint;
    if (config.model) env.AZURE_OPENAI_DEPLOYMENT = config.model;
  }
  return env;
}

// ── graph.json fallback viewer ─────────────────────────────────
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

// ── Graphify detection / capabilities ─────────────────────────
async function probeGraphify() {
  try {
    const v = await runCapture(["--version"]);
    const help = await runCapture(["--help"]);
    const caps = { installed: true, version: v.trim(), update: false, extract: false, clusterOnly: false, label: false };
    caps.extract = /extract/.test(help);
    caps.clusterOnly = /cluster-only/.test(help);
    caps.label = /label/.test(help);
    try { caps.update = /update/.test(await runCapture(["update", "--help"])); } catch { caps.update = false; }
    caps.installable = false;
    return caps;
  } catch {
    return { installed: false, version: null, update: false, extract: false, clusterOnly: false, label: false, installable: process.platform === "win32" };
  }
}
function runCapture(args) {
  return new Promise((resolve, reject) => {
    const c = spawn("graphify", args, { windowsHide: true });
    let out = "";
    c.stdout.on("data", (d) => (out += d.toString()));
    c.stderr.on("data", (d) => (out += d.toString()));
    c.on("error", reject);
    c.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(out || "exit " + code))));
  });
}

// ── Workspace scan ────────────────────────────────────────────
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
    return !/^Community\s+\d+$/i.test(value.trim());
  };

  return [...communityIds].every(hasSemanticName);
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

// ── Runner (async, single job, jobId) ─────────────────────────
function emit(job, payload) {
  const evt = { jobId: job.jobId, projectPath: job.projectPath, timestamp: new Date().toISOString(), ...payload };
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("graphify:event", evt);
}
function killTree(pid) {
  try { spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }); } catch {}
}
function buildSteps(operation, labelCfg) {
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
function spawnStep(step, job) {
  return new Promise((resolve, reject) => {
    const child = spawn("graphify", step.args, { cwd: job.projectPath, env: step.env || process.env, windowsHide: true });
    job.child = child;
    child.stdout.on("data", (d) => emit(job, { type: "stdout", message: d.toString() }));
    child.stderr.on("data", (d) => emit(job, { type: "stderr", message: d.toString() }));
    child.on("error", (e) => reject(e));
    child.on("close", (code) => {
      if (job.cancelled) return reject(new Error("cancelled"));
      code === 0 ? resolve() : reject(new Error("graphify saiu com código " + code));
    });
    if (job.cancelled) { killTree(child.pid); reject(new Error("cancelled")); }
  });
}
async function runJob(job, operation, labelCfg) {
  try {
    emit(job, { type: "started", message: "Iniciando " + operation });
    for (const step of buildSteps(operation, labelCfg)) {
      if (job.cancelled) throw new Error("cancelled");
      emit(job, { type: "stage", stage: step.name, message: step.name });
      await spawnStep(step, job);
    }
    if (job.cancelled) throw new Error("cancelled");
    emit(job, { type: "completed", message: "Concluído" });
  } catch (e) {
    if (String(e.message).includes("cancelled")) emit(job, { type: "cancelled", message: "Cancelado" });
    else emit(job, { type: "failed", message: e.message });
  } finally {
    activeJob = null;
  }
}

// ── IPC handlers ──────────────────────────────────────────────
async function registerIpcHandlers() {
  encryptionAvailable = await detectEncryption();
  console.log("[safeStorage]", { platform: process.platform, electron: process.versions.electron, encryptionAvailable });
  ipcMain.handle("workspace:select", async () => {
    const r = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] });
    if (r.canceled || !r.filePaths.length) return null;
    return r.filePaths[0];
  });

  ipcMain.handle("workspace:scan", async (_e, root) => {
    if (!root || !existsSync(root)) return { root: null, projects: [] };
    return scanWorkspace(root);
  });

  ipcMain.handle("graph:data", async (_e, projectPath) => {
    try { return await loadGraphData(projectPath); }
    catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle("config:load", async () => {
    const cfg = loadConfigFile();
    const { encryptedCredential, apiKey, ...safe } = cfg;
    return {
      ...safe,
      hasKey: Boolean(sessionApiKey && cfg.provider === sessionProvider) || (!!encryptedCredential && encryptionAvailable),
      encryptionAvailable,
    };
  });

  ipcMain.handle("config:save", async (_e, input) => {
    try {
      input = input || {};
      if (!input.workspace || !existsSync(input.workspace)) return { ok: false, error: "Workspace inválido" };
      const provider = PROVIDERS[input.provider] ? input.provider : "none";
      const previous = loadConfigFile();
      const requestedSessionOnly = Boolean(input.sessionOnly);
      const effectiveSessionOnly = requestedSessionOnly || !encryptionAvailable;
      const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
      const config = {
        workspace: input.workspace,
        provider,
        endpoint: typeof input.endpoint === "string" ? input.endpoint.trim() : "",
        model: typeof input.model === "string" ? input.model.trim() : "",
        sessionOnly: effectiveSessionOnly,
      };

      const sameProvider = previous.provider === provider;
      const credential = apiKey || (sameProvider ? await resolveProviderKey(previous) : null);
      if (provider === "none") {
        sessionApiKey = null;
        sessionProvider = null;
      } else if (credential) {
        if (effectiveSessionOnly) {
          sessionApiKey = credential;
          sessionProvider = provider;
        } else {
          sessionApiKey = null;
          sessionProvider = null;
          let encBuf;
          if (typeof safeStorage.encryptStringAsync === "function") {
            const enc = await safeStorage.encryptStringAsync(credential);
            encBuf = enc && enc.encrypted ? enc.encrypted : enc;
          } else {
            encBuf = safeStorage.encryptString(credential);
          }
          config.encryptedCredential = Buffer.from(encBuf).toString("base64");
        }
      } else if (!sameProvider) {
        sessionApiKey = null;
        sessionProvider = null;
      }

      saveSanitizedConfig(config);
      return {
        ok: true,
        workspace: config.workspace,
        provider: config.provider,
        endpoint: config.endpoint,
        model: config.model,
        sessionOnly: effectiveSessionOnly,
        hasKey: Boolean(sessionApiKey) || Boolean(config.encryptedCredential),
        hasSessionCredential: Boolean(sessionApiKey),
        encryptionAvailable,
      };
    } catch (e) {
      console.error("[config:save]", e);
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("config:disable-ai", async (_e, input) => {
    try {
      sessionApiKey = null;
      sessionProvider = null;
      const config = { workspace: input.workspace, provider: "none", endpoint: "", model: "", sessionOnly: true };
      saveSanitizedConfig(config);
      return { ok: true };
    } catch (e) {
      console.error("[config:disable-ai]", e);
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("graphify:detect", async () => {
    if (!graphifyCaps) graphifyCaps = await probeGraphify();
    return graphifyCaps;
  });

  ipcMain.handle("graphify:install", async () => {
    if (process.platform !== "win32") return { ok: false, error: "Instalação automática disponível apenas no Windows nesta versão." };
    try {
      await new Promise((resolve, reject) => {
        const child = spawn("uv", ["tool", "install", "graphifyy"], { windowsHide: true, shell: false });
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

  ipcMain.handle("provider:models", async (_e, config) => fetchProviderModels(config || {}));

  ipcMain.handle("provider:test", async (_e, config) => {
    config = config || {};
    const p = PROVIDERS[config.provider];
    if (!p) return { ok: false, message: "Provedor desconhecido" };
    if (p.backend === null) return { ok: true, message: "Sem IA — análise local, nenhuma conexão necessária" };
    const persisted = loadConfigFile();
    const suppliedKey = typeof config.apiKey === "string" ? config.apiKey.trim() : "";
    const key = suppliedKey || (persisted.provider === config.provider ? await resolveProviderKey(persisted) : null);
    if (["openai", "deepseek", "kimi", "mistral", "nvidia", "openrouter", "groq", "lmstudio", "vllm", "opencode_zen", "opencode_go", "custom"].includes(config.provider)) {
      if (!config.endpoint) return { ok: false, message: "Informe o endpoint" };
      if (["openai", "deepseek", "kimi", "mistral", "nvidia", "openrouter", "groq", "opencode_zen", "opencode_go"].includes(config.provider) && !key)
        return { ok: false, message: "Informe uma chave de API" };
      try {
        const base = config.endpoint.replace(/\/$/, "");
        const headers = key ? { Authorization: "Bearer " + key } : {};
        const modelsResponse = await fetch(base + "/models", { headers, signal: AbortSignal.timeout(30000) });
        if (!modelsResponse.ok) {
          const authMessage = [401, 403].includes(modelsResponse.status) ? "Chave inválida" : "Falha no endpoint";
          return { ok: false, message: `${authMessage} (HTTP ${modelsResponse.status})` };
        }

        const modelsPayload = await modelsResponse.json().catch(() => null);
        const modelIds = Array.isArray(modelsPayload?.data) ? modelsPayload.data.map((m) => m.id).filter(Boolean) : [];
        if (config.model && modelIds.length && !modelIds.includes(config.model))
          return { ok: false, message: "Endpoint acessível, mas o modelo informado não está listado" };

        if (config.provider === "nvidia") {
          if (!config.model) return { ok: false, message: "Informe o modelo NVIDIA" };
          const inferenceResponse = await fetch(base + "/chat/completions", {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            signal: AbortSignal.timeout(30000),
            body: JSON.stringify({
              model: config.model,
              messages: [{ role: "user", content: "Reply only OK" }],
              max_tokens: 2,
              temperature: 0,
            }),
          });
          if (!inferenceResponse.ok) {
            const authMessage = [401, 403].includes(inferenceResponse.status) ? "Chave inválida" : "Falha na inferência";
            return { ok: false, message: `${authMessage} (HTTP ${inferenceResponse.status})` };
          }
          return { ok: true, message: "Chave e modelo NVIDIA validados (inferência OK)" };
        }

        return { ok: true, message: config.model ? "Endpoint acessível, modelo listado" : "Endpoint acessível" };
      } catch (e) { return { ok: false, message: "Não foi possível conectar: " + e.message }; }
    }
    if (config.provider === "ollama") {
      try { const r = await fetch((config.endpoint || "http://localhost:11434") + "/api/tags"); return r.ok ? { ok: true, message: "Ollama local acessível" } : { ok: false, message: "Ollama HTTP " + r.status }; }
      catch (e) { return { ok: false, message: "Ollama não acessível: " + e.message }; }
    }
    if (config.provider === "gemini") {
      if (!key) return { ok: false, message: "Chave obrigatória" };
      try { const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?key=" + key); return r.ok ? { ok: true, message: "Gemini acessível" } : { ok: false, message: "Gemini HTTP " + r.status }; }
      catch (e) { return { ok: false, message: "Gemini não acessível: " + e.message }; }
    }
    return { ok: true, testable: false, message: "Validação manual — a conexão será testada na primeira geração" };
  });

  ipcMain.handle("graphify:run", async (_e, request) => {
    if (activeJob) return { jobId: null, error: "Já existe um processo em execução" };
    const { projectPath, operation, provider, endpoint, model } = request;
    if (!projectPath || !existsSync(projectPath)) return { jobId: null, error: "Projeto inválido" };
    const cfg = loadConfigFile();
    const providerKey = await resolveProviderKey(cfg);
    const labelCfg = {
      provider: provider || cfg.provider || "none",
      endpoint: endpoint || cfg.endpoint,
      model: model || cfg.model,
      env: labelEnv(provider || cfg.provider || "none", { endpoint: endpoint || cfg.endpoint, model: model || cfg.model }, providerKey),
      canLabel: (provider || cfg.provider || "none") !== "none" &&
        (Boolean(providerKey) || Boolean(PROVIDERS[provider || cfg.provider || "none"]?.keyOptional)),
    };
    if (operation === "relabel" && !labelCfg.canLabel)
      return { jobId: null, error: "Configure um provedor de IA disponível para melhorar nomes" };
    const job = { jobId: crypto.randomUUID(), projectPath, cancelled: false, child: null };
    activeJob = job;
    runJob(job, operation, labelCfg);
    return { jobId: job.jobId };
  });

  ipcMain.handle("graphify:cancel", async (_e, jobId) => {
    if (!activeJob || activeJob.jobId !== jobId) return { ok: false };
    activeJob.cancelled = true;
    if (activeJob.child) { try { activeJob.child.kill("SIGTERM"); } catch {} killTree(activeJob.child.pid); }
    return { ok: true };
  });

  ipcMain.handle("update:status", async () => updateStatus);
  ipcMain.handle("update:check", async () => checkForAppUpdates(true));
}

// ── Window ────────────────────────────────────────────────────
function createWindow(page) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "Graph Explorer",
    backgroundColor: "#0d1117",
    icon: join(__dirname, "assets", "icon.png"),
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: true,
      webSecurity: true,
    },
  });
  mainWindow.loadFile(page || join(__dirname, "public", "index.html"));
  mainWindow.webContents.on("did-finish-load", () => publishUpdateStatus());
  mainWindow.on("closed", () => { mainWindow = null; });
}

// Detecta se este módulo é o entry point do app (e não um import de harness/test).
// `electron .`: argv[1] é a pasta do app → true.
// `electron main.js`: argv[1] é main.js → true.
// Empacotado: argv[1] é .asar/exe → app.isPackaged garante true.
// Harness QA (npx electron ge-qa-full.mjs): argv[1] é um script .mjs → false.
const argv1 = process.argv[1] || "";
const isMain =
  app.isPackaged ||
  !argv1 ||
  !/\.(mjs|js|cjs)$/i.test(argv1) ||
  /[\\/]main\.(js|mjs|cjs)$/i.test(argv1);
if (isMain) {
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    graphifyCaps = await probeGraphify();
    await registerIpcHandlers();
    createWindow();
    initializeAutoUpdater();
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on("window-all-closed", () => app.quit());
}

function setMainWindow(w) { mainWindow = w; }

export { registerIpcHandlers, createWindow, detectEncryption, initializeAutoUpdater, setMainWindow };
