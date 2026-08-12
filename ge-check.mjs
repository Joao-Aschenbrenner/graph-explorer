// ge-check.mjs — processo Electron separado para validar config:load APOS reinicio.
// Usa GE_CONFIG_DIR (definido pelo pai). Carrega o app real e reporta config:load.
import { app, BrowserWindow } from "electron";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { registerIpcHandlers, setMainWindow } from "./main.js";
const __dirname = dirname(fileURLToPath(import.meta.url));

const OUT = process.env.GE_CHECK_OUT;
app.whenReady().then(async () => {
  await registerIpcHandlers();
  const win = new BrowserWindow({ show: false, webPreferences: { preload: join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true } });
  setMainWindow(win);
  win.loadFile(join(__dirname, "public", "index.html"));
  await new Promise((r) => setTimeout(r, 1800));
  const cfg = await win.webContents.executeJavaScript("window.graphExplorer.loadConfig()").catch((e) => ({ error: e.message }));
  const fs = await import("fs");
  fs.writeFileSync(OUT, JSON.stringify(cfg, null, 2));
  app.quit();
});
