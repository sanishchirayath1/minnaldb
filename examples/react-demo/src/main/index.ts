import { app, BrowserWindow, ipcMain } from 'electron'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDB } from 'minnaldb'
import { exposeDB } from 'minnaldb-electron/main'
import { schema, projects } from '../shared/schema.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const SEED_PROJECTS = [
  { name: 'Work', color: '#6366f1' },
  { name: 'Personal', color: '#10b981' },
  { name: 'Side Project', color: '#f59e0b' },
]

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 960,
    height: 680,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

app.whenReady().then(() => {
  const dbPath = join(app.getPath('userData'), 'minnaldb-tasks.db')
  console.log('[react-demo] db path:', dbPath)
  const db = createDB({ path: dbPath, schema })

  // Seed default projects if the table is empty
  const existing = db.query.projects.run()
  if (existing.length === 0) {
    db.transaction(() => {
      for (const p of SEED_PROJECTS) {
        db.insert(projects).values(p)
      }
    })
  }

  exposeDB(db, ipcMain)
  createWindow()

  app.on('window-all-closed', () => {
    db.close()
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})
