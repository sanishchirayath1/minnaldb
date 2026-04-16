import { app, ipcMain, BrowserWindow } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDB } from "minnaldb";
import { exposeDB } from "minnaldb-electron/main";
import { sqliteTable, integer, text } from "minnaldb/wire";
import __cjs_mod__ from "node:module";
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require2 = __cjs_mod__.createRequire(import.meta.url);
const notes = sqliteTable("notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  body: text("body"),
  createdAt: integer("created_at").notNull().default(() => Date.now())
});
const schema = { notes };
const __dirname$1 = dirname(fileURLToPath(import.meta.url));
function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 640,
    webPreferences: {
      // Preload script bridges the main-side DB to the renderer via contextBridge.
      // We keep nodeIntegration off and contextIsolation on for security — the
      // renderer only sees `window.minnaldb`, never raw ipcRenderer or fs.
      preload: join(__dirname$1, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  if (process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(join(__dirname$1, "../renderer/index.html"));
  }
  return win;
}
app.whenReady().then(() => {
  const dbPath = join(app.getPath("userData"), "minnaldb-demo.db");
  console.log("[minnaldb-demo] db path:", dbPath);
  const db = createDB({ path: dbPath, schema });
  exposeDB(db, ipcMain);
  createWindow();
  const tickInterval = setInterval(() => {
    db.insert(notes).values({
      title: `Auto tick at ${(/* @__PURE__ */ new Date()).toLocaleTimeString()}`,
      body: "Inserted by the main process every 5 seconds."
    });
  }, 5e3);
  app.on("window-all-closed", () => {
    clearInterval(tickInterval);
    db.close();
    if (process.platform !== "darwin") app.quit();
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
