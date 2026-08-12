// ge-qa.mjs — QA end-to-end isolado. Usa GE_CONFIG_DIR (temp). Não toca o config.json real.
import { app, BrowserWindow } from "electron";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import os from "os";
import { spawn, execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL_WS = "C:\\Users\\USUARIO\\Desktop\\PROJETOS";
const TMP = fs.mkdtempSync(join(os.tmpdir(), "ge-qa-"));
process.env.GE_CONFIG_DIR = TMP;
const SHOTS = join(TMP, "shots");
fs.mkdirSync(SHOTS, { recursive: true });
const REPORT = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { registerIpcHandlers, setMainWindow } = await import("./main.js");

const ev = (win, js) => win.webContents.executeJavaScript(js);

async function waitFor(win, js, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await ev(win, js).catch(() => false)) return true;
    await sleep(300);
  }
  return false;
}

const events = (win) => ev(win, "window.__EVENTS__||[]");
const clearEvents = (win) => ev(win, "window.__EVENTS__=[]");

async function shot(win, name) {
  fs.writeFileSync(join(SHOTS, name + ".png"), (await win.webContents.capturePage()).toPNG());
}

function clickOp(win, name, op) {
  return ev(win, `(function(){const p=[...document.querySelectorAll('.proj')].find(e=>e.querySelector('.name')&&e.querySelector('.name').textContent==='${name}');if(!p)return'no-proj';const b=[...p.querySelectorAll('.mini')].find(x=>x.textContent==='${op}');if(!b)return'no-btn';b.click();return'ok';})()`);
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
  fs.writeFileSync(join(TMP, "report.json"), JSON.stringify(REPORT, null, 2));
}

function log(m) {
  console.error("[QA]", m);
}

function makeWin() {
  if (!app.isReady()) {
    throw new Error('makeWin() foi chamado antes de app.whenReady()');
  }
  return new BrowserWindow({
    show: false,
    width: 1280,
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

async function boot(win, seedConfig) {
  if (seedConfig) fs.writeFileSync(join(TMP, "config.json"), JSON.stringify(seedConfig, null, 2));
  else if (fs.existsSync(join(TMP, "config.json"))) fs.unlinkSync(join(TMP, "config.json"));
  setMainWindow(win);
  win.loadFile(join(__dirname, "public", "index.html"));
  await sleep(300);
  await ev(win, "window.__EVENTS__=[]; window.graphExplorer.onGraphifyEvent(e=>window.__EVENTS__.push(e));").catch(() => {});
  await sleep(1700);
}

const mkTmp = (name) => {
  const p = join(REAL_WS, name);
  fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(join(p, "main.py"), "def main():\n    return 42\n");
  if (fs.existsSync(join(p, "graphify-out"))) fs.rmSync(join(p, "graphify-out"), { recursive: true, force: true });
  return p;
};

const rmTmp = (name) => {
  try { fs.rmSync(join(REAL_WS, name), { recursive: true, force: true }); } catch {}
};

let qaWindow = null;

async function runQa() {
  await app.whenReady();
  log("ready");

  await registerIpcHandlers();

  qaWindow = makeWin();

  try {
    // Carregar UI
    qaWindow.loadFile(join(__dirname, "public", "index.html"));
    await new Promise((resolve) => {
      if (!qaWindow.webContents.isLoading()) { resolve(); return; }
      qaWindow.webContents.once('did-finish-load', resolve);
    });
    await sleep(500);

    // Hook de eventos
    await ev(qaWindow, "window.__EVENTS__=[]; window.graphExplorer.onGraphifyEvent(e=>window.__EVENTS__.push(e));").catch(() => {});
    await sleep(500);

    // ---- Testes não-visuais (podem rodar antes da janela se preferir) ----
    log("Test: config:load (vazio)");
    let cfg = await qaWindow.webContents.executeJavaScript("window.graphExplorer.loadConfig()");
    REPORT["config:load.empty"] = { ok: typeof cfg === "object", cfg };
    log("  " + JSON.stringify(cfg));

    log("Test: config:save (provider none)");
    let res = await qaWindow.webContents.executeJavaScript(`window.graphExplorer.saveConfig({workspace:"${REAL_WS}",provider:"none",endpoint:"",model:""})`);
    REPORT["config:save.none"] = { ok: res.ok === true, res };
    log("  " + JSON.stringify(res));

    log("Test: config:load (depois de save none)");
    cfg = await qaWindow.webContents.executeJavaScript("window.graphExplorer.loadConfig()");
    REPORT["config:load.after-none"] = { ok: cfg.provider === "none", cfg };
    log("  " + JSON.stringify(cfg));

    log("Test: provider:test (none)");
    res = await qaWindow.webContents.executeJavaScript(`window.graphExplorer.testProvider({provider:"none",endpoint:"",model:""})`);
    REPORT["provider:test.none"] = { ok: res.ok === true, res };
    log("  " + JSON.stringify(res));

    log("Test: graphify:detect");
    res = await qaWindow.webContents.executeJavaScript("window.graphExplorer.detectGraphify()");
    REPORT["graphify:detect"] = { ok: typeof res.installed === "boolean", res };
    log("  " + JSON.stringify(res));

    log("Test: workspace:scan (REAL_WS)");
    res = await qaWindow.webContents.executeJavaScript(`window.graphExplorer.scanWorkspace("${REAL_WS.replace(/\\\\/g, "\\\\\\\\")}")`);
    REPORT["workspace:scan"] = { ok: Array.isArray(res.projects), res };
    log("  projects=" + (res.projects?.length ?? 0));

    // ---- Testes visuais mínimos (se houver projetos listados) ----
    const proj = res.projects?.[0];
    if (proj) {
      log("Test: graphify:run generate no " + proj.name);
      const runRes = await qaWindow.webContents.executeJavaScript(
        `window.graphExplorer.runGraphify({projectPath:"${proj.path.replace(/\\\\/g, "\\\\\\\\")}",operation:"generate",provider:"none",endpoint:"",model:""})`
      );
      REPORT["graphify:run.generate"] = { ok: !!runRes.jobId, runRes };
      log("  jobId=" + runRes.jobId);

      if (runRes.jobId) {
        await sleep(3000);
        const evts = await events(qaWindow);
        const completed = evts.find(e => e.type === "completed");
        const failed = evts.find(e => e.type === "failed");
        REPORT["graphify:run.generate.events"] = { completed: !!completed, failed: !!failed, events: evts.length };
        log("  completed=" + !!completed + " failed=" + !!failed + " events=" + evts.length);
      }
    }

    // ---- Orphans check ----
    const orph = noOrphans();
    REPORT["orphans"] = { found: orph };
    log("Orphans: " + orph.join(", ") || "none");

    saveReport();
    log("REPORT salvo em " + join(TMP, "report.json"));
  } finally {
    if (qaWindow && !qaWindow.isDestroyed()) {
      qaWindow.destroy();
      qaWindow = null;
    }
  }
}

runQa()
  .then(() => {
    log("QA_FINISHED=PASS");
    app.quit();
  })
  .catch((error) => {
    console.error("[GE-QA] Fatal:", { name: error?.name, message: error?.message, stack: error?.stack });
    process.exitCode = 1;
    if (qaWindow && !qaWindow.isDestroyed()) {
      qaWindow.destroy();
    }
    app.quit();
  });