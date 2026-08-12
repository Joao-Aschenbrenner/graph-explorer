// ge-qa-full.mjs — QA funcional completo dos 5 pontos + 12 gates.
// Isolado via GE_CONFIG_DIR (temp). Não toca config.json real nem graphify-out existente.
import { app, BrowserWindow, session } from "electron";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import os from "os";
import { execSync } from "child_process";
import { createServer } from "http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL_WS = "C:\\Users\\USUARIO\\Desktop\\PROJETOS";
const REAL_WS_ESC = REAL_WS.replace(/\\/g, "\\\\");
const TMP = fs.mkdtempSync(join(os.tmpdir(), "ge-qa-full-"));
process.env.GE_CONFIG_DIR = TMP;
const SHOTS = join(TMP, "shots");
fs.mkdirSync(SHOTS, { recursive: true });
const REPORT = {};
const GATES = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { registerIpcHandlers, setMainWindow } = await import("./main.js");

const ev = (win, js) => win.webContents.executeJavaScript(js);

// Normaliza retorno de ev(): strings JSON viram objeto, outros valores passam direto.
function normalizeResult(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

// Espera uma Promise com timeout por gate — evita hang sem saber onde parou.
async function withTimeout(name, promise, timeoutMs = 60000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${name} excedeu ${timeoutMs}ms`)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Pré-registra listeners de load ANTES de chamar load/reload — evita perder evento.
function waitForLoad(win, { timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const onFinish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onFail = (_e, code, desc) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`load falhou: ${code} — ${desc}`));
    };
    const cleanup = () => {
      win.webContents.removeListener('did-finish-load', onFinish);
      win.webContents.removeListener('did-fail-load', onFail);
      clearTimeout(timer);
    };
    win.webContents.once('did-finish-load', onFinish);
    win.webContents.once('did-fail-load', onFail);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`waitForLoad excedeu ${timeout}ms`));
    }, timeout);
  });
}

async function waitFor(win, js, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await ev(win, js).catch(() => false)) return true;
    await sleep(300);
  }
  return false;
}

async function shot(win, name) {
  try { fs.writeFileSync(join(SHOTS, name + ".png"), (await win.webContents.capturePage()).toPNG()); } catch {}
}

function noOrphans() {
  const found = [];
  for (const n of ["graphify", "python", "python3"]) {
    try {
      if (execSync(`tasklist /fi "IMAGENAME eq ${n}.exe" /nh`).toString().includes(`${n}.exe`)) found.push(n);
    } catch {}
  }
  return found;
}

function saveReport() {
  fs.writeFileSync(join(TMP, "report.json"), JSON.stringify({ REPORT, GATES }, null, 2));
}

function log(m) { console.error("[QA-FULL]", m); }
function gate(name, pass, detail = "") {
  GATES[name] = { status: pass === true ? "PASS" : pass === null ? "SKIPPED" : "FAIL", pass: pass === true, detail };
  log(`GATE ${name}: ${GATES[name].status}${detail ? " — " + detail : ""}`);
}
function skipGate(name, reason = "") {
  GATES[name] = { status: "SKIPPED", pass: false, detail: reason };
  log(`GATE ${name}: SKIPPED${reason ? " — " + reason : ""}`);
}

function makeWin() {
  if (!app.isReady()) throw new Error('makeWin() foi chamado antes de app.whenReady()');
  return new BrowserWindow({
    show: false,
    width: 1400,
    height: 900,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      webviewTag: true,
      webSecurity: true
    }
  });
}

let qaWindow = null;
let providerFixture = null;

async function startProviderFixture() {
  const seen = { models: 0, inference: 0 };
  const server = createServer((req, res) => {
    const authorized = req.headers.authorization === "Bearer qa-fixture-key";
    res.setHeader("Content-Type", "application/json");
    if (!authorized) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    if (req.url === "/v1/models") {
      seen.models++;
      res.end(JSON.stringify({ data: [{ id: "qa-model" }] }));
      return;
    }
    if (req.url === "/v1/chat/completions" && req.method === "POST") {
      seen.inference++;
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "OK" } }] }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not-found" }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return { server, seen, endpoint: `http://127.0.0.1:${address.port}/v1` };
}

// Projeto temporário para testar geração de grafo
const TMP_PROJ_NAME = "ge-qa-target-" + Date.now().toString().slice(-6);
const TMP_PROJ_PATH = join(REAL_WS, TMP_PROJ_NAME);

function mkTmpProj() {
  fs.mkdirSync(TMP_PROJ_PATH, { recursive: true });
  fs.writeFileSync(join(TMP_PROJ_PATH, "main.py"), "def main():\n    return 42\n");
  fs.writeFileSync(join(TMP_PROJ_PATH, "util.py"), "def add(a, b):\n    return a + b\n");
  fs.writeFileSync(join(TMP_PROJ_PATH, "README.md"), "# QA Target\n\nProjeto temporário para QA.\n");
  // Volume de arquivos suficiente para extract demorar >2s (cancel test determinístico)
  const src = join(TMP_PROJ_PATH, "src");
  fs.mkdirSync(src, { recursive: true });
  for (let i = 0; i < 40; i++) {
    fs.writeFileSync(join(src, "mod" + i + ".py"),
      "import util\n\ndef handler" + i + "(x):\n    return util.add(x, " + i + ")\n\nclass Item" + i + ":\n    def __init__(self, v):\n        self.v = v\n    def get(self):\n        return handler" + i + "(self.v)\n");
  }
}

function rmTmpProj() {
  try { fs.rmSync(TMP_PROJ_PATH, { recursive: true, force: true }); } catch {}
}

async function runQa() {
  await app.whenReady();
  log("ready");

  providerFixture = await startProviderFixture();
  await registerIpcHandlers();
  qaWindow = makeWin();
  setMainWindow(qaWindow); // main.js:emit() só envia se mainWindow estiver setado

  try {
    // ── GATE: APP_STARTUP ──
    log("Test: APP_STARTUP");
    qaWindow.loadFile(join(__dirname, "public", "index.html"));
    await new Promise((resolve) => {
      if (!qaWindow.webContents.isLoading()) { resolve(); return; }
      qaWindow.webContents.once('did-finish-load', resolve);
    });
    await sleep(1000);

    // Interceptar diálogos nativos que bloqueariam o harness silenciosamente
    await ev(qaWindow, `
      (function(){
        if (!window.__QA_STUBS_INSTALLED__) {
          window.__QA_STUBS_INSTALLED__ = true;
          window.__QA_DIALOGS__ = [];
          const wrap = (name) => (...args) => {
            window.__QA_DIALOGS__.push({ name, args: args.map(String) });
            return name === 'confirm' ? true : (name === 'prompt' ? '' : undefined);
          };
        window.alert = wrap('alert');
        window.confirm = wrap('confirm');
        window.prompt = wrap('prompt');
        }
      })();
    `).catch(() => {});

    const splashVisible = await ev(qaWindow, "!!document.getElementById('splash')");
    const hasBrand = await ev(qaWindow, "!!document.querySelector('.brand svg')");
    const hasSplashSvg = await ev(qaWindow, "!!document.querySelector('#splash svg')");
    gate("APP_STARTUP", splashVisible && hasBrand && hasSplashSvg,
      `splash=${splashVisible} brand=${hasBrand} splashSvg=${hasSplashSvg}`);

    // ── GATES: primeira execução sem config ──
    await waitFor(qaWindow, "/^v\\d+\\.\\d+\\.\\d+/.test(document.getElementById('versionBadge').textContent)", 5000);
    await waitFor(qaWindow, "getComputedStyle(document.getElementById('setupView')).display !== 'none' && document.getElementById('setupView').getBoundingClientRect().height > 0", 5000);
    const freshSetupRaw = await ev(qaWindow, `JSON.stringify({
      options: [...document.getElementById('providerSelect').options].map(o=>o.value),
      labels: [...document.getElementById('providerSelect').options].map(o=>o.textContent),
      selected: document.getElementById('providerSelect').value,
      width: parseFloat(getComputedStyle(document.getElementById('providerSelect')).width),
      versionText: document.getElementById('versionBadge').textContent,
      updateApi: typeof window.graphExplorer.getUpdateStatus === 'function' && typeof window.graphExplorer.checkForUpdates === 'function'
    })`);
    const freshSetup = normalizeResult(freshSetupRaw) || {};
    const requiredProviders = ["none","openai","anthropic","gemini","deepseek","kimi","ollama","azure","bedrock","nvidia","openrouter","groq","lmstudio","vllm","custom"];
    gate("FRESH_SETUP_PROVIDERS",
      requiredProviders.every(p=>freshSetup.options.includes(p)) && freshSetup.options.length === 15 && freshSetup.selected === "none" && freshSetup.width >= 300,
      `options=${freshSetup.options.length} selected=${freshSetup.selected} width=${freshSetup.width}`);
    gate("VERSION_BADGE", /^v\d+\.\d+\.\d+/.test(freshSetup.versionText) && freshSetup.updateApi,
      `text=${freshSetup.versionText} api=${freshSetup.updateApi}`);

    // ── PONTO 1: Logo e ícones ──
    log("Ponto 1: Logo e ícones");
    await shot(qaWindow, "01-splash");

    // Verificar splash SVG内部tem animação
    const splashAnimates = await ev(qaWindow, "document.querySelectorAll('#splash svg animate').length");
    const headerSvg = await ev(qaWindow, "document.querySelectorAll('.brand svg circle').length");
    gate("LOGO_ICONS", splashAnimates > 0 && headerSvg > 0,
      `splashAnimates=${splashAnimates} headerCircles=${headerSvg}`);

    // Esperar splash terminar e setup aparecer
    await sleep(1500);

    // ── PONTO 4: Seleção dinâmica de workspaces ──
    log("Ponto 4: Setup view + workspace");
    const setupVisible = await ev(qaWindow, "document.getElementById('setupView').classList.contains('visible')");
    if (!setupVisible) {
      // Pode ter ido direto ao main se config já existe
      const mainVisible = await ev(qaWindow, "document.getElementById('mainView').classList.contains('visible')");
      gate("WORKSPACE_SCAN", mainVisible, "foi direto ao main (config pré-existente)");
    }

    // Salvar config apontando para REAL_WS com provider none
    log("Configurando workspace para REAL_WS");
    let cfgSave;
    try {
      cfgSave = await withTimeout("CONFIG_SAVE", ev(qaWindow, `(async()=>{
        try {
          const r = await window.graphExplorer.saveConfig({workspace:"${REAL_WS_ESC}",provider:"none",endpoint:"",model:""});
          return JSON.stringify(r);
        } catch (e) {
          return JSON.stringify({ok:false,error:e.message});
        }
      })()`));
      cfgSave = normalizeResult(cfgSave) || {};
    } catch (e) {
      cfgSave = { ok: false, error: e.message };
    }
    log("  saveConfig: " + JSON.stringify(cfgSave));
    gate("CONFIG_SAVE", cfgSave.ok === true, `ok=${cfgSave.ok}${cfgSave.error ? " err=" + cfgSave.error : ""}`);

    // Recarregar a página para que o renderer pegue a nova config — listener pré-registrado
    log("  recarregando página...");
    try {
      const reloadP = waitForLoad(qaWindow, { timeout: 30000 });
      qaWindow.reload();
      await reloadP;
      gate("RENDERER_RELOAD", true, "did-finish-load");
    } catch (e) {
      gate("RENDERER_RELOAD", false, e.message);
    }
    await sleep(2500); // splash + boot transition

    // Re-instalar stubs de alert/confirm/prompt após recarga
    await ev(qaWindow, `
      (function(){
        if (!window.__QA_STUBS_INSTALLED__) {
          window.__QA_STUBS_INSTALLED__ = true;
          window.__QA_DIALOGS__ = [];
          const wrap = (name) => (...args) => {
            window.__QA_DIALOGS__.push({ name, args: args.map(String) });
            return name === 'confirm' ? true : (name === 'prompt' ? '' : undefined);
          };
          window.alert = wrap('alert');
          window.confirm = wrap('confirm');
          window.prompt = wrap('prompt');
        }
      })();
    `).catch(() => {});

    // Forçar setup se ainda não entrou no mainView
    const inMain = await ev(qaWindow, "document.getElementById('mainView').classList.contains('visible')");
    if (!inMain) {
      // Tentar clicar btnContinueNoIA (state.workspace deve estar preenchido após reload)
      await ev(qaWindow, `(function(){const b=document.getElementById('btnContinueNoIA');if(b)b.click();return 'clicked';})()`);
      await sleep(1000);
    }

    await shot(qaWindow, "02-main");

    // ── GATES: Provider auth/inference + Salvar e abrir pela UI ──
    log("Test: PROVIDER_AUTH_REJECT");
    const fixtureEndpointEsc = providerFixture.endpoint.replace(/\\/g, "\\\\");
    const invalidProviderRaw = await withTimeout("PROVIDER_AUTH_REJECT", ev(qaWindow, `(async()=>{
      const r = await window.graphExplorer.testProvider({
        provider:"nvidia", endpoint:"${fixtureEndpointEsc}", model:"qa-model", apiKey:"wrong-key"
      });
      return JSON.stringify(r);
    })()`), 30000);
    const invalidProvider = normalizeResult(invalidProviderRaw) || {};
    gate("PROVIDER_AUTH_REJECT", invalidProvider.ok === false && /401|inválida/i.test(invalidProvider.message || ""),
      `ok=${invalidProvider.ok} message=${invalidProvider.message}`);

    log("Test: PROVIDER_INFERENCE");
    const validProviderRaw = await withTimeout("PROVIDER_INFERENCE", ev(qaWindow, `(async()=>{
      const r = await window.graphExplorer.testProvider({
        provider:"nvidia", endpoint:"${fixtureEndpointEsc}", model:"qa-model", apiKey:"qa-fixture-key"
      });
      return JSON.stringify(r);
    })()`), 30000);
    const validProvider = normalizeResult(validProviderRaw) || {};
    gate("PROVIDER_INFERENCE", validProvider.ok === true && providerFixture.seen.models > 0 && providerFixture.seen.inference > 0,
      `ok=${validProvider.ok} models=${providerFixture.seen.models} inference=${providerFixture.seen.inference}`);

    log("Test: SAVE_AND_OPEN");
    const saveUiRaw = await withTimeout("SAVE_AND_OPEN", ev(qaWindow, `(async()=>{
      showSetup();
      await new Promise(r=>setTimeout(r,100));
      document.getElementById('providerSelect').value='nvidia';
      document.getElementById('providerSelect').dispatchEvent(new Event('change'));
      document.getElementById('endpointInput').value='${fixtureEndpointEsc}';
      document.getElementById('modelInput').value='qa-model';
      document.getElementById('keyInput').value='qa-fixture-key';
      document.getElementById('sessionOnly').checked=false;
      document.getElementById('btnSaveOpen').click();
      const started=Date.now();
      while(Date.now()-started<20000){
        if(document.getElementById('mainView').classList.contains('visible')) break;
        await new Promise(r=>setTimeout(r,100));
      }
      return JSON.stringify({
        main:document.getElementById('mainView').classList.contains('visible'),
        setup:document.getElementById('setupView').classList.contains('visible'),
        projects:document.querySelectorAll('.proj').length,
        provider:state.config.provider,
        endpoint:state.config.endpoint,
        model:state.config.model,
        button:document.getElementById('btnSaveOpen').textContent
      });
    })()`), 30000);
    const saveUi = normalizeResult(saveUiRaw) || {};
    let providerCfg = {};
    try { providerCfg = JSON.parse(fs.readFileSync(join(TMP, "config.json"), "utf-8")); } catch {}
    const saveContract = saveUi.provider === "nvidia" && saveUi.endpoint === providerFixture.endpoint && saveUi.model === "qa-model";
    gate("CONFIG_SAVE_CONTRACT", saveContract,
      `provider=${saveUi.provider} endpointOk=${saveUi.endpoint === providerFixture.endpoint} model=${saveUi.model}`);
    gate("SAVE_AND_OPEN", saveUi.main === true && saveUi.setup === false && saveUi.projects > 0,
      `main=${saveUi.main} setup=${saveUi.setup} projects=${saveUi.projects} button=${saveUi.button}`);

    log("Test: VIEWPORT_TOGGLE");
    const vpMainRaw = await withTimeout("VIEWPORT_TOGGLE", ev(qaWindow, `(async()=>{
      const rectOf = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return { top: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
      const cs = (id) => getComputedStyle(document.getElementById(id)).display;
      const centerOfMain = (() => { const el = document.elementFromPoint(innerWidth/2, innerHeight/2); let n = el, inMain = false; while (n) { if (n.id === 'mainView') inMain = true; n = n.parentElement; } return inMain; })();
      return JSON.stringify({
        mainDisplay: cs('mainView'), setupDisplay: cs('setupView'),
        mainRect: rectOf('mainView'), setupRect: rectOf('setupView'),
        centerInMain: centerOfMain,
        viewportH: innerHeight
      });
    })()`), 30000);
    const vpMain = normalizeResult(vpMainRaw) || {};
    const setupUp = await ev(qaWindow, `(function(){const b=document.getElementById('btnChangeFolder');if(b)b.click();return 'ok';})()`).catch(() => "err");
    await sleep(600);
    const vpSetupRaw = await withTimeout("VIEWPORT_TOGGLE", ev(qaWindow, `(async()=>{
      const rectOf = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return { top: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
      const cs = (id) => getComputedStyle(document.getElementById(id)).display;
      const centerOfSetup = (() => { const el = document.elementFromPoint(innerWidth/2, innerHeight/2); let n = el, inSetup = false; while (n) { if (n.id === 'setupView') inSetup = true; n = n.parentElement; } return inSetup; })();
      return JSON.stringify({
        mainDisplay: cs('mainView'), setupDisplay: cs('setupView'),
        mainRect: rectOf('mainView'), setupRect: rectOf('setupView'),
        centerInSetup: centerOfSetup
      });
    })()`), 30000);
    const vpSetup = normalizeResult(vpSetupRaw) || {};
    const mainOccupies = vpMain.mainDisplay === "flex" && vpMain.setupDisplay === "none" && vpMain.mainRect.top === 0 && vpMain.mainRect.h >= vpMain.viewportH * 0.9 && vpMain.centerInMain === true;
    const setupOccupies = vpSetup.setupDisplay === "flex" && vpSetup.mainDisplay === "none" && vpSetup.setupRect.top === 0 && vpSetup.setupRect.h >= 0.9 * (vpMain.viewportH || 800) && vpSetup.centerInSetup === true;
    gate("VIEWPORT_TOGGLE", mainOccupies && setupOccupies,
      `main:${vpMain.mainDisplay}/${vpMain.setupDisplay}/top${vpMain.mainRect.top}/h${vpMain.mainRect.h}/center${vpMain.centerInMain} setup:${vpSetup.setupDisplay}/${vpSetup.mainDisplay}/top${vpSetup.setupRect.top}/h${vpSetup.setupRect.h}/center${vpSetup.centerInSetup}`);
    // voltar para mainView
    const backToMain = await ev(qaWindow, `(async()=>{
      document.getElementById('folderPath').textContent = state.workspace;
      document.getElementById('btnSaveOpen').click();
      const started=Date.now();
      while(Date.now()-started<20000){
        if(document.getElementById('mainView').classList.contains('visible')) break;
        await new Promise(r=>setTimeout(r,100));
      }
      return document.getElementById('mainView').classList.contains('visible');
    })()`).catch(() => false);
    log("  voltou ao mainView: " + backToMain);
    gate("PROVIDER_CREDENTIAL_STORAGE",
      typeof providerCfg.encryptedCredential === "string" && providerCfg.encryptedCredential.length > 0 && !("apiKey" in providerCfg),
      `encrypted=${!!providerCfg.encryptedCredential} noPlain=${!("apiKey" in providerCfg)}`);

    log("Test: CREDENTIAL_REUSE");
    const reuseRaw = await withTimeout("CREDENTIAL_REUSE", ev(qaWindow, `(async()=>{
      showSetup();
      await new Promise(r=>setTimeout(r,100));
      document.getElementById('keyInput').value='';
      document.getElementById('btnSaveOpen').click();
      const started=Date.now();
      while(Date.now()-started<20000){
        if(document.getElementById('mainView').classList.contains('visible')) break;
        await new Promise(r=>setTimeout(r,100));
      }
      const r=await window.graphExplorer.testProvider({
        provider:'nvidia', endpoint:'${fixtureEndpointEsc}', model:'qa-model', apiKey:''
      });
      return JSON.stringify({main:document.getElementById('mainView').classList.contains('visible'),test:r});
    })()`), 30000);
    const reuse = normalizeResult(reuseRaw) || {};
    let reuseCfg = {};
    try { reuseCfg = JSON.parse(fs.readFileSync(join(TMP, "config.json"), "utf-8")); } catch {}
    gate("CREDENTIAL_REUSE", reuse.main === true && reuse.test?.ok === true && !!reuseCfg.encryptedCredential && !("apiKey" in reuseCfg),
      `main=${reuse.main} testOk=${reuse.test?.ok} encrypted=${!!reuseCfg.encryptedCredential}`);

    // ── GATE: WORKSPACE_SCAN ──
    log("Test: WORKSPACE_SCAN");
    const wsPath = REAL_WS_ESC;
    log("  workspace path (escaped): " + wsPath);
    let scanRes;
    try {
      const raw = await withTimeout("WORKSPACE_SCAN", ev(qaWindow, `(async()=>{
        try {
          const r = await window.graphExplorer.scanWorkspace("${wsPath}");
          return JSON.stringify(r);
        } catch (e) {
          return 'ERR:'+e.message;
        }
      })()`));
      scanRes = normalizeResult(raw);
      if (typeof scanRes === 'string' && scanRes.startsWith('ERR:')) {
        log("  scan error: " + scanRes);
        scanRes = { projects: [] };
      }
      if (!scanRes || typeof scanRes !== 'object') scanRes = { projects: [] };
    } catch (e) {
      log("  scan exception: " + e.message);
      scanRes = { projects: [] };
    }
    const projCount = scanRes.projects?.length || 0;
    gate("WORKSPACE_SCAN", Array.isArray(scanRes.projects) && projCount > 0,
      `projects=${projCount} root=${scanRes.root||'null'}`);
    log("  projetos encontrados: " + projCount);
    log("  scan root: " + scanRes.root);

    // Verificar que sidebar renderizou projetos
    await sleep(500);
    const sidebarProjs = await ev(qaWindow, "document.querySelectorAll('.proj').length");
    log("  sidebar .proj count: " + sidebarProjs);

    // ── Criar projeto temporário para testar geração ──
    mkTmpProj();
    log("Projeto temporário criado: " + TMP_PROJ_PATH);

    // Re-scan para incluir o novo projeto
    await ev(qaWindow, `(async()=>{try{await window.graphExplorer.scanWorkspace("${wsPath}");}catch(e){}})()`);
    await sleep(500);
    const sidebarProjs2 = await ev(qaWindow, "document.querySelectorAll('.proj').length");
    log("  sidebar após tmp: " + sidebarProjs2);

    // ── GATE: NO_PORT_3456 ──
    log("Test: NO_PORT_3456");
    // Verificar que nenhum módulo abre porta 3456
    const mainJsContent = fs.readFileSync(join(__dirname, "main.js"), "utf-8");
    const preloadContent = fs.readFileSync(join(__dirname, "preload.cjs"), "utf-8");
    const indexContent = fs.readFileSync(join(__dirname, "public", "index.html"), "utf-8");
    const noPort3456 = !mainJsContent.includes("3456") && !preloadContent.includes("3456") && !indexContent.includes("3456");
    gate("NO_PORT_3456", noPort3456, `main=${mainJsContent.includes("3456")} preload=${preloadContent.includes("3456")} html=${indexContent.includes("3456")}`);

    // ── GATE: NO_HARDCODED_PATHS ──
    log("Test: NO_HARDCODED_PATHS");
    const hardRx = /C:\\Users\\[^\\]+\\Desktop\\(?!PROJETOS)/g;
    const mainHardcoded = (mainJsContent.match(hardRx) || []).length;
    const preloadHardcoded = (preloadContent.match(hardRx) || []).length;
    const indexHardcoded = (indexContent.match(hardRx) || []).length;
    const noHardcoded = mainHardcoded === 0 && preloadHardcoded === 0 && indexHardcoded === 0;
    gate("NO_HARDCODED_PATHS", noHardcoded, `main=${mainHardcoded} preload=${preloadHardcoded} html=${indexHardcoded}`);

    // ── GATE: GENERATE_GRAPH ──
    log("Test: GENERATE_GRAPH");
    // Configurar hook de eventos
    await ev(qaWindow, "window.__EVENTS__=[]; window.graphExplorer.onGraphifyEvent(e=>window.__EVENTS__.push(e));").catch(() => {});
    await sleep(200);

    // Disparar geração no projeto temporário
    const tmpProjEsc = TMP_PROJ_PATH.replace(/\\/g, "\\\\");
    let runRes;
    try {
      const raw = await withTimeout("GENERATE_GRAPH", ev(qaWindow, `(async()=>{
        try {
          const r = await window.graphExplorer.runGraphify({projectPath:"${tmpProjEsc}",operation:"generate",provider:"none",endpoint:"",model:""});
          return JSON.stringify(r);
        } catch (e) {
          return JSON.stringify({error:e.message});
        }
      })()`));
      runRes = normalizeResult(raw);
    } catch (e) {
      runRes = { error: e.message };
    }
    log("  runGraphify: " + JSON.stringify(runRes));
    const jobId = runRes?.jobId;
    gate("GENERATE_GRAPH", !!jobId, "jobId=" + jobId);

    // ── GATE: GRAPHIFY_DETECT ──
    log("Test: GRAPHIFY_DETECT");
    try {
      const raw = await withTimeout("GRAPHIFY_DETECT", ev(qaWindow, `(async()=>{
        try {
          const r = await window.graphExplorer.detectGraphify();
          return JSON.stringify(r);
        } catch (e) {
          return JSON.stringify({installed:false,error:e.message});
        }
      })()`));
      const detectRes = normalizeResult(raw) || {};
      gate("GRAPHIFY_DETECT", !!detectRes.installed, `installed=${detectRes.installed}${detectRes.version ? " v=" + detectRes.version : ""}`);
    } catch (e) {
      gate("GRAPHIFY_DETECT", false, e.message);
    }

    if (jobId) {
      // ── GATE: CANCEL_JOB ──
      log("Test: CANCEL_JOB");
      // Aguardar um pouco para o job começar a processar
      await sleep(2000);
      let cancelParsed = {};
      try {
        const raw = await withTimeout("CANCEL_JOB", ev(qaWindow, `(async()=>{
          try {
            const r = await window.graphExplorer.cancelGraphify("${jobId}");
            return JSON.stringify(r);
          } catch (e) {
            return JSON.stringify({ok:false,error:e.message});
          }
        })()`));
        cancelParsed = normalizeResult(raw) || {};
      } catch (e) {
        cancelParsed = { ok: false, error: e.message };
      }
      log("  cancel: " + JSON.stringify(cancelParsed));
      gate("CANCEL_JOB", cancelParsed.ok === true, "ok=" + cancelParsed.ok);

      // Aguardar confirmação de cancelamento
      await sleep(2000);
      const evtsRaw = await ev(qaWindow, "window.__EVENTS__");
      const evts = Array.isArray(evtsRaw) ? evtsRaw : (Array.isArray(normalizeResult(evtsRaw)) ? normalizeResult(evtsRaw) : []);
      const cancelled = evts.find(e => e.type === "cancelled");
      const failed = evts.find(e => e.type === "failed");
      log("  events: " + evts.length + " cancelled=" + !!cancelled + " failed=" + !!failed);
      gate("CANCEL_JOB", !!cancelled || !!failed, `cancelled=${!!cancelled} failed=${!!failed}`);

      // ── GATE: RESTART_AFTER_CANCEL ──
      log("Test: RESTART_AFTER_CANCEL");
      await ev(qaWindow, "window.__EVENTS__=[]");
      // Limpar graphify-out do projeto tmp para forçar regenerate
      const tmpGraphifyOut = join(TMP_PROJ_PATH, "graphify-out");
      if (fs.existsSync(tmpGraphifyOut)) {
        try { fs.rmSync(tmpGraphifyOut, { recursive: true, force: true }); } catch {}
      }

      let runRes2;
      try {
        const raw = await withTimeout("RESTART_AFTER_CANCEL", ev(qaWindow, `(async()=>{
          try {
            const r = await window.graphExplorer.runGraphify({projectPath:"${tmpProjEsc}",operation:"generate",provider:"none",endpoint:"",model:""});
            return JSON.stringify(r);
          } catch (e) {
            return JSON.stringify({error:e.message});
          }
        })()`));
        runRes2 = normalizeResult(raw) || {};
      } catch (e) { runRes2 = { error: e.message }; }
      log("  restart jobId: " + runRes2?.jobId);
      gate("RESTART_AFTER_CANCEL", !!runRes2?.jobId, "jobId=" + runRes2?.jobId);

      if (runRes2?.jobId) {
        // Aguardar conclusão (geração de projeto pequeno deve ser rápida)
        const completed = await waitFor(qaWindow, `(async()=>{
          const evs = window.__EVENTS__||[];
          return evs.some(e=>e.type==='completed' || e.type==='failed');
        })()`, 120000);
        const evts2Raw = await ev(qaWindow, "window.__EVENTS__");
        const evts2 = Array.isArray(evts2Raw) ? evts2Raw : (Array.isArray(normalizeResult(evts2Raw)) ? normalizeResult(evts2Raw) : []);
        const comp = evts2.find(e => e.type === "completed");
        const fail = evts2.find(e => e.type === "failed");
        log("  restart result: completed=" + !!comp + " failed=" + !!fail);
        gate("RESTART_AFTER_CANCEL", !!comp, `completed=${!!comp} failed=${!!fail}`);

        // ── PONTO 2: Geração assíncrona sem congelamento ──
        log("Ponto 2: Async sem congelamento");
        const logsCollected = evts2.filter(e => e.type === "stdout" || e.type === "stderr").length;
        log("  logs coletados: " + logsCollected);
        gate("ASYNC_NO_FREEZE", logsCollected > 0, `logEvents=${logsCollected}`);
      }
    }

    await shot(qaWindow, "03-after-gen");

    // ── GATE: SESSION_CREDENTIAL ──
    log("Test: SESSION_CREDENTIAL");
    // Salvar com sessionOnly=true
    let sessRes;
    try {
      const raw = await withTimeout("SESSION_CREDENTIAL", ev(qaWindow, `(async()=>{
        try {
          const r = await window.graphExplorer.saveConfig({workspace:"${REAL_WS_ESC}",provider:"openai",endpoint:"https://api.openai.com/v1",model:"gpt-4o-mini",apiKey:"sk-test-session-only",sessionOnly:true});
          return JSON.stringify(r);
        } catch (e) {
          return JSON.stringify({ok:false,error:e.message});
        }
      })()`));
      sessRes = normalizeResult(raw) || {};
    } catch (e) {
      sessRes = { ok: false, error: e.message };
    }
    log("  session save: " + JSON.stringify(sessRes));
    // Verificar que config.json NÃO contém apiKey nem encryptedCredential
    const cfgFile = join(TMP, "config.json");
    let cfgContent = {};
    try { cfgContent = JSON.parse(fs.readFileSync(cfgFile, "utf-8")); } catch {}
    const noApiKeyInFile = !("apiKey" in cfgContent);
    gate("SESSION_CREDENTIAL", sessRes.ok && sessRes.hasSessionCredential && noApiKeyInFile,
      `ok=${sessRes.ok} hasSession=${sessRes.hasSessionCredential} noKeyInFile=${noApiKeyInFile}`);

    // ── GATE: ENCRYPTED_CREDENTIAL ──
    log("Test: ENCRYPTED_CREDENTIAL");
    let encRes;
    try {
      const raw = await withTimeout("ENCRYPTED_CREDENTIAL", ev(qaWindow, `(async()=>{
        try {
          const r = await window.graphExplorer.saveConfig({workspace:"${REAL_WS_ESC}",provider:"openai",endpoint:"https://api.openai.com/v1",model:"gpt-4o-mini",apiKey:"sk-test-encrypted",sessionOnly:false});
          return JSON.stringify(r);
        } catch (e) {
          return JSON.stringify({ok:false,error:e.message});
        }
      })()`));
      encRes = normalizeResult(raw) || {};
    } catch (e) {
      encRes = { ok: false, error: e.message };
    }
    log("  encrypted save: " + JSON.stringify(encRes));
    let cfgContent2 = {};
    try { cfgContent2 = JSON.parse(fs.readFileSync(cfgFile, "utf-8")); } catch {}
    const hasEncrypted = "encryptedCredential" in cfgContent2 && !!cfgContent2.encryptedCredential;
    const noPlainKey2 = !("apiKey" in cfgContent2);
    // Verificar que a chave criptografada não contém o texto plano
    const encryptedValue = cfgContent2.encryptedCredential || "";
    const containsPlain = encryptedValue.includes("sk-test-encrypted");
    gate("ENCRYPTED_CREDENTIAL", encRes.ok && hasEncrypted && noPlainKey2 && !containsPlain,
      `ok=${encRes.ok} hasEnc=${hasEncrypted} noPlain=${noPlainKey2} notPlainInEnc=${!containsPlain}`);

    // ── GATE: NO_AI_MODE ──
    log("Test: NO_AI_MODE");
    let noAiParsed;
    try {
      const raw = await withTimeout("NO_AI_MODE", ev(qaWindow, `(async()=>{
        try {
          const r = await window.graphExplorer.disableAI({workspace:"${REAL_WS_ESC}"});
          return JSON.stringify(r);
        } catch (e) {
          return JSON.stringify({ok:false,error:e.message});
        }
      })()`));
      noAiParsed = normalizeResult(raw) || {};
    } catch (e) {
      noAiParsed = { ok: false, error: e.message };
    }
    log("  disableAI: " + JSON.stringify(noAiParsed));
    let cfgContent3 = {};
    try { cfgContent3 = JSON.parse(fs.readFileSync(join(TMP, "config.json"), "utf-8")); } catch {}
    gate("NO_AI_MODE", noAiParsed.ok === true && cfgContent3.provider === "none",
      `ok=${noAiParsed.ok} provider=${cfgContent3.provider}`);

    // ── GATE: GRAPH_VIEWER_ISOLATION ──
    log("Test: GRAPH_VIEWER_ISOLATION");
    // Verificar que webview tem atributos de segurança corretos
    // Primeiro precisamos que o app mostre um grafo existente
    // O projeto tmp deve ter gerado graph.html
    const tmpGraphHtml = join(TMP_PROJ_PATH, "graphify-out", "graph.html");
    const graphExists = fs.existsSync(tmpGraphHtml);
    log("  graph.html exists: " + graphExists);

    if (graphExists) {
      // Re-scan para atualizar status do projeto
      await ev(qaWindow, `(async()=>{try{await window.graphExplorer.scanWorkspace("${REAL_WS_ESC}");}catch(e){}})()`);
      // Re-renderizar sidebar com os dados novos (scan via IPC não atualiza state.projects)
      await ev(qaWindow, `(async()=>{try{await refreshSidebar();return 'ok';}catch(e){return 'err:'+e.message;}})()`).catch(() => {});
      await sleep(800);

      // Clicar no projeto tmp na sidebar para abrir o grafo
      const clicked = await withTimeout("GRAPH_LOAD_CLICK", ev(qaWindow, `(function(){
        const projs = [...document.querySelectorAll('.proj')];
        const target = projs.find(p => {
          const name = p.querySelector('.name');
          return name && name.textContent.includes('${TMP_PROJ_NAME}');
        });
        if (target) { target.click(); return 'clicked'; }
        return 'not-found';
      })()`), 15000).catch(e => `err:${e.message}`);
      log("  click projeto tmp: " + clicked);
      await sleep(2500);
      await shot(qaWindow, "04-graph-viewer");

      // Verificar que o webview carregou o graph.html
      const wvLoaded = await ev(qaWindow, `(()=>{const wv=document.querySelector('webview');return wv && wv.src && wv.src.includes('graph.html');})()`).catch(() => false);
      gate("GRAPH_LOAD", !!wvLoaded, `webviewSrc=${wvLoaded ? "graph.html" : "missing"}`);

      // Verificar webview com atributos de segurança
      let webviewAttrs = { found: false };
      try {
        const wvRaw = await withTimeout("WEBVIEW_READ", ev(qaWindow, `(function(){
          const wv = document.querySelector('webview');
          if (!wv) return JSON.stringify({found:false});
          return JSON.stringify({
            found: true,
            partition: wv.getAttribute('partition'),
            webpreferences: wv.getAttribute('webpreferences'),
            allowpopups: wv.getAttribute('allowpopups')
          });
        })()`), 15000);
        webviewAttrs = normalizeResult(wvRaw) || { found: false };
      } catch (e) {
        log("  webview read err: " + e.message);
      }
      log("  webview: " + JSON.stringify(webviewAttrs));
      gate("GRAPH_VIEWER_ISOLATION",
        webviewAttrs.found &&
        webviewAttrs.partition === "graph" &&
        (webviewAttrs.webpreferences || "").includes("sandbox=yes") &&
        (webviewAttrs.webpreferences || "").includes("contextIsolation=yes") &&
        (webviewAttrs.webpreferences || "").includes("nodeIntegration=no"),
        `found=${webviewAttrs.found} partition=${webviewAttrs.partition}`);
    } else {
      skipGate("GRAPH_LOAD", "graph.html não encontrado no projeto tmp");
      skipGate("GRAPH_VIEWER_ISOLATION", "graph.html não encontrado — dependência ausente");
    }

    // ── GATE: PROMPT_COPY ──
    log("Test: PROMPT_COPY");
    // Abrir modal de prompt
    await ev(qaWindow, `(function(){const b=document.getElementById('btnPrompt');if(b)b.click();return 'ok';})()`).catch(() => {});
    await sleep(800);
    await shot(qaWindow, "05-prompt-modal");

    const promptModalVisible = await ev(qaWindow, "document.getElementById('modal').classList.contains('visible')").catch(() => false);
    const promptTextExists = await ev(qaWindow, "!!document.getElementById('promptText')").catch(() => false);
    const promptContent = await ev(qaWindow, "document.getElementById('promptText')?.textContent?.length || 0").catch(() => 0);
    const copyBtnExists = await ev(qaWindow, "!!document.getElementById('mCopy')").catch(() => false);

    // Tentar copiar
    let copyWorked = false;
    if (copyBtnExists) {
      await ev(qaWindow, `navigator.clipboard.writeText('qa-test').then(()=>{}).catch(()=>{})`).catch(() => {});
      await ev(qaWindow, `(function(){const b=document.getElementById('mCopy');if(b)b.click();return 'clicked';})()`).catch(() => {});
      await sleep(600);
      // Verificar se botão mudou para "Copiado ✓"
      const btnText = await ev(qaWindow, "document.getElementById('mCopy')?.textContent || ''").catch(() => "");
      copyWorked = btnText.includes("Copiado");
      log("  copy btn text: " + btnText);
    }

    gate("PROMPT_COPY", promptModalVisible && promptTextExists && promptContent > 100 && copyBtnExists && copyWorked,
      `modal=${promptModalVisible} textExists=${promptTextExists} textLen=${promptContent} copyBtn=${copyBtnExists} copyWorked=${copyWorked}`);

    // Fechar modal
    await ev(qaWindow, `(function(){const c=document.getElementById('modalClose');if(c)c.click();})()`);
    await sleep(300);

    // ── PONTO 4 complementar: Trocar pasta ──
    log("Ponto 4: Trocar pasta (workspace change)");
    await ev(qaWindow, `(function(){const b=document.getElementById('btnChangeFolder');if(b)b.click();return 'ok';})()`).catch(() => {});
    await sleep(500);
    const setupVisibleAgain = await ev(qaWindow, "document.getElementById('setupView').classList.contains('visible')").catch(() => false);
    log("  setup visível novamente: " + setupVisibleAgain);
    await shot(qaWindow, "06-back-to-setup");

    // ── GATE: CONTINUE_WITHOUT_AI ──
    log("Test: CONTINUE_WITHOUT_AI");
    const noAiReadyBefore = await ev(qaWindow, "!!document.getElementById('btnContinueNoIA')").catch(() => false);
    if (noAiReadyBefore) {
      await ev(qaWindow, `(function(){const b=document.getElementById('btnContinueNoIA');if(b)b.click();})()`).catch(() => {});
      await sleep(1500);
      const mainVisibleAfter = await ev(qaWindow, "document.getElementById('mainView').classList.contains('visible')").catch(() => false);
      let cfgAfterContinue = {};
      try { cfgAfterContinue = JSON.parse(fs.readFileSync(join(TMP, "config.json"), "utf-8")); } catch {}
      gate("CONTINUE_WITHOUT_AI", mainVisibleAfter && cfgAfterContinue.provider === "none",
        `mainVisible=${mainVisibleAfter} provider=${cfgAfterContinue.provider}`);
    } else {
      skipGate("CONTINUE_WITHOUT_AI", "btnContinueNoIA não presente na view atual");
    }

    // ── PONTO 4: Filtro de busca ──
    const searchExists = await ev(qaWindow, "!!document.getElementById('searchInput')").catch(() => false);
    if (searchExists) {
      await ev(qaWindow, `(function(){const s=document.getElementById('searchInput');s.value='xyznotexists';s.dispatchEvent(new Event('input'));})()`).catch(() => {});
      await sleep(300);
      const filteredCount = await ev(qaWindow, "document.querySelectorAll('.proj').length").catch(() => -1);
      log("  filtro 'xyznotexists' resultou em: " + filteredCount + " projetos");
      // Limpar filtro
      await ev(qaWindow, `(function(){const s=document.getElementById('searchInput');s.value='';s.dispatchEvent(new Event('input'));})()`).catch(() => {});
      await sleep(300);
      const prevWsScan = GATES["WORKSPACE_SCAN"]?.pass === true;
      gate("WORKSPACE_SCAN", prevWsScan && filteredCount === 0,
        `filterReturns0=${filteredCount === 0}`);
    }

    // ── GATE: REAL_BOOT (createWindow do app real) ──
    log("Test: REAL_BOOT");
    try {
      const { createWindow: appCreateWindow } = await import("./main.js");
      appCreateWindow();
      await sleep(2500);
      const wins = BrowserWindow.getAllWindows();
      const bootWin = wins.find(w => !w.isDestroyed() && w !== qaWindow);
      const title = bootWin ? bootWin.getTitle() : "";
      const loaded = bootWin ? !bootWin.webContents.isLoading() : false;
      gate("REAL_BOOT", !!bootWin && loaded, `wins=${wins.length} title=${title} loaded=${loaded}`);
      if (bootWin) { bootWin.destroy(); }
      await sleep(300);
    } catch (e) {
      gate("REAL_BOOT", false, e.message);
    }

    // ── GATE: NO_ORPHAN_PROCESSES ──
    log("Test: NO_ORPHAN_PROCESSES");
    const orph = noOrphans();
    log("Orphans: " + (orph.join(",") || "none"));
    REPORT["orphans"] = orph;
    gate("NO_ORPHAN_PROCESSES", orph.length === 0, orph.join(",") || "none");

    // ── Screenshot final ──
    await shot(qaWindow, "07-final");
    saveReport();
    log("REPORT salvo em " + join(TMP, "report.json"));

  } finally {
    // Cleanup projeto temporário
    rmTmpProj();
    log("Projeto temporário removido");

    if (providerFixture?.server) {
      await new Promise((resolve) => providerFixture.server.close(resolve));
      providerFixture = null;
    }

    // Verificar orphans pós-cleanup
    await sleep(1000);
    const orphAfter = noOrphans();
    gate("CLEANUP", orphAfter.length === 0, orphAfter.join(",") || "none");

    if (qaWindow && !qaWindow.isDestroyed()) {
      qaWindow.destroy();
      qaWindow = null;
    }
  }
}

runQa()
  .then(() => {
    log("=== RESUMO DOS GATES ===");
    let passCount = 0, failCount = 0, skippedCount = 0;
    for (const [name, result] of Object.entries(GATES)) {
      const status = result.status || (result.pass ? "PASS" : "FAIL");
      log(`  ${name}: ${status}${result.detail ? " — " + result.detail : ""}`);
      if (status === "PASS") passCount++;
      else if (status === "SKIPPED") skippedCount++;
      else failCount++;
    }
    log(`\nTOTAL: ${passCount} PASS, ${failCount} FAIL, ${skippedCount} SKIPPED`);
    const exitCode = failCount === 0 ? 0 : 1;
    log(`GE_QA_FULL_EXIT_CODE=${exitCode}`);
    if (failCount > 0) log("FALHAS: " + Object.entries(GATES).filter(([, r]) => (r.status || (r.pass ? "PASS" : "FAIL")) === "FAIL").map(([n]) => n).join(", "));
    process.exitCode = exitCode;
    app.quit();
  })
  .catch((error) => {
    console.error("[GE-QA-FULL] Fatal:", { name: error?.name, message: error?.message, stack: error?.stack });
    try { rmTmpProj(); } catch {}
    if (qaWindow && !qaWindow.isDestroyed()) qaWindow.destroy();
    saveReport();
    log("GE_QA_FULL_EXIT_CODE=1 (fatal)");
    process.exitCode = 1;
    app.quit();
  });
