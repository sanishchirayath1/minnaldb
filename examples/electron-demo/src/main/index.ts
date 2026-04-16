import { app, BrowserWindow, ipcMain } from 'electron'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDB } from 'minnaldb'
import { exposeDB } from 'minnaldb-electron/main'
import { schema, notes } from '../shared/schema.js'

// In ESM, __dirname doesn't exist. Recreate it from import.meta.url so the
// preload path below resolves correctly in both dev and packaged builds.
const __dirname = dirname(fileURLToPath(import.meta.url))

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 900,
    height: 640,
    webPreferences: {
      // Preload script bridges the main-side DB to the renderer via contextBridge.
      // We keep nodeIntegration off and contextIsolation on for security — the
      // renderer only sees `window.minnaldb`, never raw ipcRenderer or fs.
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // electron-vite injects this env var in dev, pointing at the Vite renderer
  // server. In production we load the built HTML file from disk.
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

app.whenReady().then(() => {
  // The DB lives in main and is the single owner of the SQLite handle. All
  // renderer queries go through the IPC bridge below.
  const dbPath = join(app.getPath('userData'), 'minnaldb-demo.db')
  console.log('[minnaldb-demo] db path:', dbPath)
  const db = createDB({ path: dbPath, schema })

  exposeDB(db, ipcMain)
  createWindow()

  // Push reactivity demo: every 5 seconds, insert a "tick" note. The renderer's
  // useQuery subscription will receive the update over IPC and re-render — no
  // polling, no manual refresh. Useful proof that the bridge handles push.
  const tickInterval = setInterval(() => {
    db.insert(notes).values({
      title: `Auto tick at ${new Date().toLocaleTimeString()}`,
      body: 'Inserted by the main process every 5 seconds.',
    })
  }, 5000)

  app.on('window-all-closed', () => {
    clearInterval(tickInterval)
    db.close()
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})
