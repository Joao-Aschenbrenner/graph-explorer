import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  safeStorage,
  webContents,
  Menu,
} from "electron";
import { promises as fsp, existsSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { spawn } from "child_process";
import crypto from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Em builds empacotados (portable/instalador), __dirname é um diretório temporário.
// userData garante persistência real; GE_CONFIG_DIR (QA) continua com prioridade.
const CONFIG_DIR = process.env.GE_CONFIG_DIR || app.getPath("userData");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

let mainWindow = null;
let sessionApiKey = null;
let encryptionAvailable = false;
let graphifyCaps = null;
let activeJob = null;

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
  writeFileSync(CONFIG_PATH, JSON.stringify(safe, null, 2));
}
async function resolveProviderKey(config) {
  if (sessionApiKey) return sessionApiKey;
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
  none: { label: "Sem IA (análise local)", group: "direct", backend: null },
  openai: { label: "OpenAI", group: "direct", backend: "openai", endpoint: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  anthropic: { label: "Anthropic / Claude", group: "direct", backend: "claude", endpoint: "https://api.anthropic.com", model: "claude-3-5-haiku-latest" },
  gemini: { label: "Google Gemini", group: "direct", backend: "gemini", endpoint: "https://generativelanguage.googleapis.com", model: "gemini-1.5-flash" },
  deepseek: { label: "DeepSeek", group: "direct", backend: "deepseek", endpoint: "https://api.deepseek.com", model: "deepseek-chat" },
  kimi: { label: "Kimi", group: "direct", backend: "kimi", endpoint: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
  ollama: { label: "Ollama (local)", group: "direct", backend: "ollama", endpoint: "http://localhost:11434", model: "llama3" },
  azure: { label: "Azure OpenAI", group: "direct", backend: "azure", endpoint: "", model: "" },
  bedrock: { label: "AWS Bedrock", group: "direct", backend: "bedrock", endpoint: "", model: "" },
  nvidia: { label: "NVIDIA NIM", group: "compatible", backend: "openai", endpoint: "https://integrate.api.nvidia.com/v1", model: "meta/llama-3.1-8b-instruct" },
  openrouter: { label: "OpenRouter", group: "compatible", backend: "openai", endpoint: "https://openrouter.ai/api/v1", model: "" },
  groq: { label: "Groq", group: "compatible", backend: "openai", endpoint: "https://api.groq.com/openai/v1", model: "" },
  lmstudio: { label: "LM Studio", group: "compatible", backend: "openai", endpoint: "http://localhost:1234/v1", model: "local-model" },
  vllm: { label: "vLLM", group: "compatible", backend: "openai", endpoint: "http://localhost:8000/v1", model: "" },
  custom: { label: "Custom (OpenAI-compatible)", group: "compatible", backend: "openai", endpoint: "", model: "" },
};

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
    return caps;
  } catch {
    return { installed: false, version: null, update: false, extract: false, clusterOnly: false, label: false };
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
const MARKERS = [
  ".git", "package.json", "pyproject.toml", "requirements.txt", "setup.py",
  "Cargo.toml", "go.mod", "pom.xml", "build.gradle", "composer.json",
  ".sln", ".csproj", "Dockerfile", "graphify-out",
];
function graphHtmlPath(p) { return join(p, "graphify-out", "graph.html"); }

async function scanWorkspace(root) {
  const projects = [];
  const consider = async (name, p) => {
    let isProject = false, status = "no-graph", graphUrl = null;
    try {
      const entries = await fsp.readdir(p, { withFileTypes: true });
      if (entries.some((e) => MARKERS.includes(e.name))) isProject = true;
      const gh = graphHtmlPath(p);
      if (existsSync(gh)) { status = "has-graph"; graphUrl = pathToFileURL(gh).href; isProject = true; }
    } catch { return; }
    if (isProject) projects.push({ name, path: p, status, graphUrl });
  };
  await consider(root.split(/[\\/]/).pop(), root);
  let dirs = [];
  try { dirs = (await fsp.readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory()); } catch {}
  for (const d of dirs) {
    if (["node_modules", ".git", "venv", ".venv", "dist", "build", "target"].includes(d.name)) continue;
    await consider(d.name, join(root, d.name));
  }
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
  if (operation === "generate") {
    steps.push({ name: "Extraindo estrutura do código (AST)", args: ["extract", ".", "--code-only"] });
    steps.push({ name: "Agrupando comunidades", args: ["cluster-only", "."] });
  } else if (operation === "update") {
    if (graphifyCaps && graphifyCaps.update) steps.push({ name: "Atualizando grafo", args: ["update", "."] });
    else { steps.push({ name: "Extraindo estrutura do código (AST)", args: ["extract", ".", "--code-only"] }); steps.push({ name: "Agrupando comunidades", args: ["cluster-only", "."] }); }
  } else if (operation === "recluster") {
    steps.push({ name: "Reagrupando comunidades", args: ["cluster-only", "."] });
  } else if (operation === "relabel") {
    const p = PROVIDERS[labelCfg.provider];
    if (!p || !p.backend) throw new Error("Provedor sem backend de IA");
    steps.push({ name: "Nomeando comunidades com IA (" + p.label + ")", args: ["label", ".", "--backend", p.backend, "--missing-only"], env: labelCfg.env });
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

  ipcMain.handle("config:load", async () => {
    const cfg = loadConfigFile();
    const { encryptedCredential, apiKey, ...safe } = cfg;
    return {
      ...safe,
      hasKey: Boolean(sessionApiKey) || (!!encryptedCredential && encryptionAvailable),
      encryptionAvailable,
    };
  });

  ipcMain.handle("config:save", async (_e, input) => {
    try {
      const requestedSessionOnly = Boolean(input.sessionOnly);
      const effectiveSessionOnly = requestedSessionOnly || !encryptionAvailable;
      const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
      const config = {
        workspace: input.workspace,
        provider: input.provider,
        endpoint: input.endpoint,
        model: input.model,
        sessionOnly: effectiveSessionOnly,
      };
      if (apiKey) {
        if (effectiveSessionOnly) {
          sessionApiKey = apiKey;
          delete config.encryptedCredential;
        } else {
          sessionApiKey = null;
          let encBuf;
          if (typeof safeStorage.encryptStringAsync === "function") {
            const enc = await safeStorage.encryptStringAsync(apiKey);
            encBuf = enc && enc.encrypted ? enc.encrypted : enc;
          } else {
            encBuf = safeStorage.encryptString(apiKey);
          }
          config.encryptedCredential = Buffer.from(encBuf).toString("base64");
        }
      }
      saveSanitizedConfig(config);
      return { ok: true, sessionOnly: effectiveSessionOnly, hasSessionCredential: Boolean(sessionApiKey), encryptionAvailable };
    } catch (e) {
      console.error("[config:save]", e);
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("config:disable-ai", async (_e, input) => {
    try {
      sessionApiKey = null;
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

  ipcMain.handle("provider:test", async (_e, config) => {
    const p = PROVIDERS[config.provider];
    if (!p) return { ok: false, message: "Provedor desconhecido" };
    if (p.backend === null) return { ok: true, message: "Sem IA — análise local, nenhuma conexão necessária" };
    const key = config.apiKey || sessionApiKey;
    if (["openai", "deepseek", "kimi", "nvidia", "openrouter", "groq", "lmstudio", "vllm", "custom"].includes(config.provider)) {
      if (!config.endpoint) return { ok: false, message: "Informe o endpoint" };
      try {
        const r = await fetch(config.endpoint.replace(/\/$/, "") + "/models", { headers: { Authorization: "Bearer " + (key || "") } });
        if (r.status === 200) return { ok: true, message: "Endpoint acessível, modelo listado" };
        if (r.status === 401) return { ok: false, message: "Chave inválida (401)" };
        return { ok: true, message: "Endpoint acessível (HTTP " + r.status + ")" };
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
    };
    if (operation === "relabel" && (!providerKey || labelCfg.provider === "none"))
      return { jobId: null, error: "Informe um provedor de IA com chave para melhorar nomes" };
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
  mainWindow.on("closed", () => { mainWindow = null; });
}

const isMain = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    graphifyCaps = await probeGraphify();
    await registerIpcHandlers();
    createWindow();
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on("window-all-closed", () => app.quit());
}

function setMainWindow(w) { mainWindow = w; }

export { registerIpcHandlers, createWindow, detectEncryption, setMainWindow };
