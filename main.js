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
let graphifyUpdatePromise = null;
let graphifyUpdateCheckedAt = 0;
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
      const parameterBillions = (value) => {
        const match = String(value || "").match(/([\d.]+)\s*B/i);
        return match ? Number(match[1]) : NaN;
      };
      const sized = models.filter((m) => Number.isFinite(parameterBillions(m.meta))).sort((a, b) => parameterBillions(a.meta) - parameterBillions(b.meta));
      if (sized.length >= 3) {
        sized.forEach((m) => { m.profile = "balanced"; });
        sized[0].profile = "fast";
        sized[sized.length - 1].profile = "quality";
        sized[Math.floor((sized.length - 1) / 2)].profile = "balanced";
      } else if (sized.length === 2) {
        sized[0].profile = "fast";
        sized[1].profile = "quality";
      } else if (sized.length === 1) {
        sized[0].profile = "balanced";
      }
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

// Ambiente do subprocesso Graphify usa allowlist positiva: process.env inteiro
// NUNCA é propagado. A API key do provider vai somente por env (nunca em args
// CLI, nunca em log). sanitizeEnvValue remove NUL/CR/LF antes de qualquer uso.
const GRAPHIFY_BASE_ENV_KEYS = [
  "PATH", "Path", "HOME", "USERPROFILE", "TEMP", "TMP",
  "LOCALAPPDATA", "APPDATA", "SYSTEMROOT", "COMSPEC", "SYSTEMDRIVE", "WINDIR",
  "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "UV_TOOL_DIR", "UV_TOOL_BIN_DIR",
];

function sanitizeEnvValue(value) {
  if (value == null) return "";
  return String(value).replace(/[\0\r\n]/g, "").trim().slice(0, 4096);
}

function buildGraphifyBaseEnv() {
  const env = {};
  for (const key of GRAPHIFY_BASE_ENV_KEYS) {
    const value = process.env[key];
    if (typeof value === "string" && value.length) env[key] = sanitizeEnvValue(value);
  }
  return env;
}

function labelEnv(provider, config, providerKey) {
  const env = buildGraphifyBaseEnv();
  const p = PROVIDERS[provider];
  if (!p || !p.backend) return env;
  if (p.backend === "openai") {
    env.OPENAI_API_KEY = sanitizeEnvValue(providerKey || "");
    env.OPENAI_BASE_URL = sanitizeEnvValue(config.endpoint || "");
    env.OPENAI_MODEL = sanitizeEnvValue(config.model || "");
  } else if (p.backend === "claude") {
    env.ANTHROPIC_API_KEY = sanitizeEnvValue(providerKey || "");
    if (config.endpoint) env.ANTHROPIC_BASE_URL = sanitizeEnvValue(config.endpoint);
  } else if (p.backend === "gemini") {
    env.GEMINI_API_KEY = sanitizeEnvValue(providerKey || "");
  } else if (p.backend === "deepseek") {
    env.DEEPSEEK_API_KEY = sanitizeEnvValue(providerKey || "");
    if (config.endpoint) env.DEEPSEEK_BASE_URL = sanitizeEnvValue(config.endpoint);
  } else if (p.backend === "kimi") {
    env.KIMI_API_KEY = sanitizeEnvValue(providerKey || "");
    if (config.endpoint) env.KIMI_BASE_URL = sanitizeEnvValue(config.endpoint);
  } else if (p.backend === "ollama") {
    if (config.endpoint) { const host = sanitizeEnvValue(config.endpoint); env.OLLAMA_HOST = host; env.OPENAI_BASE_URL = host; }
  } else if (p.backend === "azure") {
    env.AZURE_OPENAI_API_KEY = sanitizeEnvValue(providerKey || "");
    if (config.endpoint) env.AZURE_OPENAI_ENDPOINT = sanitizeEnvValue(config.endpoint);
    if (config.model) env.AZURE_OPENAI_DEPLOYMENT = sanitizeEnvValue(config.model);
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
    const workerFile = app.isPackaged
      ? join(process.resourcesPath, "app.asar.unpacked", "public", "graph-data-worker.cjs")
      : join(__dirname, "public", "graph-data-worker.cjs");
    const worker = new Worker(workerFile, { workerData: { graphPath, projectPath } });
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

// ── Graphify lifecycle + smart preflight ─────────────────────
const GRAPHIFY_UPDATE_TTL_MS = 6 * 60 * 60 * 1000;
const GRAPHIFY_IGNORE_BEGIN = "# BEGIN GRAPH EXPLORER SMART EXCLUDES";
const GRAPHIFY_IGNORE_END = "# END GRAPH EXPLORER SMART EXCLUDES";
const SMART_EXCLUDE_NAMES = [
  "backups/", "backup/", "backup_original/", "**/backup_original/",
  "**/wineprefix/", "**/drive_c/windows/",
  "node_modules/", "vendor/", ".venv/", "venv/", ".tox/", ".nox/",
  "dist/", "build/", "target/", "coverage/", "__pycache__/"
];
const SMART_EXCLUDE_PATTERNS = ["*.zip", "*.7z", "*.rar", "*.tar", "*.tar.gz", "*.tgz", "*.iso", "*.dmg", "*.img", "*.bak"];

function parseVersion(value) {
  const match = String(value || "").match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1, 4).map(Number) : null;
}
function compareVersions(a, b) {
  const av = parseVersion(a), bv = parseVersion(b);
  if (!av || !bv) return 0;
  for (let i = 0; i < 3; i++) if (av[i] !== bv[i]) return av[i] > bv[i] ? 1 : -1;
  return 0;
}
async function latestGraphifyVersion() {
  try {
    const response = await fetch("https://pypi.org/pypi/graphifyy/json", { signal: AbortSignal.timeout(12000) });
    if (!response.ok) return null;
    const payload = await response.json();
    return payload?.info?.version || null;
  } catch { return null; }
}
// runTool é usado apenas para o gerenciador de pacotes uv (auto-update do
// Graphify) — comando fixo por allowlist, args validados, shell nunca usado.
const RUNTOOL_COMMANDS = new Set(["uv"]);
function runTool(command, args, timeoutMs = 180000) {
  return new Promise((resolvePromise, reject) => {
    if (!RUNTOOL_COMMANDS.has(command)) { reject(new Error("comando de ferramenta não permitido")); return; }
    if (!Array.isArray(args) || args.some((a) => typeof a !== "string" || a === "" || /[\r\n\0]/.test(a))) { reject(new Error("argumentos de ferramenta inválidos")); return; }
    const child = spawn(command, args, { windowsHide: true, shell: false });
    let output = "";
    let settled = false;
    const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); fn(value); };
    const timer = setTimeout(() => { try { child.kill(); } catch {} finish(reject, new Error(`${command} excedeu ${timeoutMs}ms`)); }, timeoutMs);
    child.stdout?.on("data", (d) => (output += d.toString()));
    child.stderr?.on("data", (d) => (output += d.toString()));
    child.once("error", (error) => finish(reject, error));
    child.once("close", (code) => code === 0 ? finish(resolvePromise, output) : finish(reject, new Error(output || `${command} saiu com código ${code}`)));
  });
}
async function ensureLatestGraphify(force = false) {
  if (!force && graphifyUpdateCheckedAt && Date.now() - graphifyUpdateCheckedAt < GRAPHIFY_UPDATE_TTL_MS && graphifyCaps) return graphifyCaps;
  if (graphifyUpdatePromise) return graphifyUpdatePromise;
  graphifyUpdatePromise = (async () => {
    const before = await probeGraphify();
    const latest = await latestGraphifyVersion();
    let updateMessage = "";
    let updateError = null;
    const needsUpgrade = !before.installed || !latest || compareVersions(before.version, latest) < 0;
    if (needsUpgrade) {
      try {
        updateMessage = before.installed
          ? await runTool("uv", ["tool", "upgrade", "graphifyy"])
          : await runTool("uv", ["tool", "install", "graphifyy"]);
      } catch (error) { updateError = error.message; }
    }
    const after = await probeGraphify();
    graphifyCaps = {
      ...after,
      latestVersion: latest,
      updateChecked: true,
      updateAvailable: Boolean(latest && after.installed && compareVersions(after.version, latest) < 0),
      updated: Boolean(before.installed && after.installed && before.version !== after.version),
      updateMessage: updateMessage.trim().slice(-1000),
      updateError,
    };
    graphifyUpdateCheckedAt = Date.now();
    return graphifyCaps;
  })().finally(() => { graphifyUpdatePromise = null; });
  return graphifyUpdatePromise;
}
function managedIgnoreBlock(extra = []) {
  const rules = [...new Set([...SMART_EXCLUDE_NAMES, ...SMART_EXCLUDE_PATTERNS, ...extra])];
  return `${GRAPHIFY_IGNORE_BEGIN}\n# Gerenciado pelo Graph Explorer. Evita backups, binários e árvores de dependências gigantes.\n${rules.join("\n")}\n${GRAPHIFY_IGNORE_END}`;
}
async function discoverLargeRootFiles(projectPath) {
  const extra = [];
  const scan = async (dir, depth = 0) => {
    if (depth > 1) return;
    let entries = [];
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries.slice(0, 5000)) {
      const full = join(dir, entry.name);
      const lower = entry.name.toLowerCase();
      if (entry.isDirectory()) {
        if (["backups", "backup", "backup_original", "node_modules", "vendor", ".venv", "venv", "dist", "build", "target", "graphify-out"].includes(lower)) continue;
        await scan(full, depth + 1);
      } else if (entry.isFile()) {
        try {
          const st = await fsp.stat(full);
          if (st.size >= 512 * 1024 * 1024) extra.push('/' + relative(projectPath, full).replaceAll('\\', '/'));
        } catch {}
      }
    }
  };
  await scan(projectPath, 0);
  return extra;
}
async function preflightGraphifyProject(projectPath) {
  const ignorePath = join(projectPath, ".graphifyignore");
  const hugeFiles = await discoverLargeRootFiles(projectPath);
  const block = managedIgnoreBlock(hugeFiles);
  let existing = "";
  try { existing = await fsp.readFile(ignorePath, "utf8"); } catch {}
  const start = existing.indexOf(GRAPHIFY_IGNORE_BEGIN);
  const end = existing.indexOf(GRAPHIFY_IGNORE_END);
  let next;
  if (start >= 0 && end >= start) {
    next = existing.slice(0, start) + block + existing.slice(end + GRAPHIFY_IGNORE_END.length);
  } else {
    next = `${existing.trimEnd()}${existing.trim() ? "\n\n" : ""}${block}\n`;
  }
  let written = false, warning = null;
  try { await fsp.writeFile(ignorePath, next, "utf8"); written = true; } catch (error) { warning = error.message; }
  return {
    written, warning, ignorePath, hugeFiles,
    summary: `Pastas ignoradas: backups, backup_original, wineprefix, dependências/builds e arquivos compactados${hugeFiles.length ? `; ${hugeFiles.length} arquivo(s) >= 512 MB` : ""}.`,
  };
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
  const numeric = Number(pid);
  if (!Number.isInteger(numeric) || numeric <= 0) return;
  try { spawn("taskkill", ["/pid", String(numeric), "/T", "/F"], { windowsHide: true }); } catch {}
}
// Contrato do subprocesso Graphify: comando fixo, operações e flags internas —
// o renderer nunca fornece comando nem array de args arbitrário.
const GRAPHIFY_OPERATIONS = new Set(["generate", "update", "recluster", "relabel"]);
const GRAPHIFY_ARGS_FIRST = new Set(["extract", "update", "cluster-only", "label"]);
const GRAPHIFY_ARGS_FLAGS = new Set([".", "--code-only", "--no-cluster", "--no-label", "--no-viz", "--missing-only", "--backend"]);
function validateGraphifyArgs(args) {
  if (!Array.isArray(args) || !args.length) return false;
  if (!GRAPHIFY_ARGS_FIRST.has(args[0])) return false;
  for (const arg of args.slice(1)) {
    if (typeof arg !== "string" || arg === "") return false;
    if (/[\r\n\0]/.test(arg)) return false;
    if (arg.startsWith("-") && !GRAPHIFY_ARGS_FLAGS.has(arg)) return false;
  }
  return true;
}
function buildSteps(operation, labelCfg) {
  const steps = [];
  if (!GRAPHIFY_OPERATIONS.has(operation)) throw new Error("operação inválida");
  const p = PROVIDERS[labelCfg.provider];
  const labelStep = (missingOnly = true) => ({
    name: "Otimizando nomes das comunidades com IA (" + p.label + ")",
    args: missingOnly
      ? ["label", ".", "--backend", p.backend, "--missing-only", "--no-viz"]
      : ["label", ".", "--backend", p.backend, "--no-viz"],
    env: labelCfg.env,
  });

  if (operation === "generate") {
    steps.push({ name: "Extraindo estrutura do código (AST) — análise local", args: ["extract", ".", "--code-only", "--no-cluster"] });
    steps.push({ name: "Agrupando comunidades — sem IA", args: ["cluster-only", ".", "--no-label", "--no-viz"] });
  } else if (operation === "update") {
    if (graphifyCaps && graphifyCaps.update) {
      steps.push({ name: "Atualizando código — análise local", args: ["update", ".", "--no-cluster"] });
      steps.push({ name: "Reagrupando comunidades — sem IA", args: ["cluster-only", ".", "--no-label", "--no-viz"] });
    } else {
      steps.push({ name: "Extraindo estrutura do código (AST) — análise local", args: ["extract", ".", "--code-only", "--no-cluster"] });
      steps.push({ name: "Agrupando comunidades — sem IA", args: ["cluster-only", ".", "--no-label", "--no-viz"] });
    }
  } else if (operation === "recluster") {
    steps.push({ name: "Reagrupando comunidades — sem IA", args: ["cluster-only", ".", "--no-label", "--no-viz"] });
  } else if (operation === "relabel") {
    if (!p || !p.backend) throw new Error("Provedor sem backend de IA");
    steps.push(labelStep(false));
  }
  for (const step of steps) {
    if (!validateGraphifyArgs(step.args)) throw new Error("argumentos graphify fora do contrato");
  }
  return steps;
}
function spawnStep(step, job) {
  return new Promise((resolve, reject) => {
    // Comando fixo "graphify" + args validados pelo contrato; shell nunca é usado.
    if (!validateGraphifyArgs(step.args)) return reject(new Error("argumentos graphify fora do contrato"));
    // Env allowlisted: só chaves/valores sanitizados entram no subprocesso.
    const cleanEnv = {};
    const sourceEnv = step.env || buildGraphifyBaseEnv();
    for (const [key, value] of Object.entries(sourceEnv)) {
      if (typeof key === "string" && key.length > 0 && !/[\r\n\0]/.test(key)) {
        cleanEnv[key] = sanitizeEnvValue(value);
      }
    }
    const child = spawn("graphify", step.args, { cwd: job.projectPath, env: cleanEnv, windowsHide: true });
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
    emit(job, { type: "stage", stage: "Verificando atualização do Graphify", message: "Verificando atualização do Graphify" });
    const caps = await ensureLatestGraphify(false);
    emit(job, { type: "stdout", message: `[Graphify] versão ${caps.version || "não detectada"}${caps.latestVersion ? ` · mais recente ${caps.latestVersion}` : ""}${caps.updated ? " · atualizado agora" : ""}\n` });
    if (caps.updateError) emit(job, { type: "stderr", message: `[Graphify] aviso de atualização: ${caps.updateError}\n` });
    emit(job, { type: "stage", stage: "Pré-análise e exclusões seguras", message: "Pré-análise e exclusões seguras" });
    const preflight = await preflightGraphifyProject(job.projectPath);
    emit(job, { type: "stdout", message: `[Graphify] ${preflight.summary}\n[Graphify] ${preflight.written ? ".graphifyignore atualizado" : "não foi possível gravar .graphifyignore"}${preflight.warning ? `: ${preflight.warning}` : ""}\n` });
    for (const step of buildSteps(operation, labelCfg)) {
      if (job.cancelled) throw new Error("cancelled");
      emit(job, { type: "stage", stage: step.name, message: step.name });
      await spawnStep(step, job);
    }
    if (job.cancelled) throw new Error("cancelled");
    emit(job, { type: "completed", message: operation === "relabel" ? "Otimização IA concluída" : "Grafo local concluído — use Otimizar IA quando quiser melhorar os nomes" });
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

  ipcMain.handle("graphify:detect", async () => ensureLatestGraphify(false));

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

        if (["nvidia", "opencode_zen", "opencode_go"].includes(config.provider)) {
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
          return { ok: true, message: "Chave e modelo validados (inferência OK)" };
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
    ensureLatestGraphify(true).catch((error) => console.warn("[graphify:update]", error.message));
    initializeAutoUpdater();
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on("window-all-closed", () => app.quit());
}

function setMainWindow(w) { mainWindow = w; }

export { registerIpcHandlers, createWindow, detectEncryption, initializeAutoUpdater, setMainWindow };
