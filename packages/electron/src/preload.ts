// Preload helper. Call `exposeMinnaldbBridge()` from your Electron preload
// script and the renderer will find `window.minnaldb` populated with a
// MinnaldbBridge.
//
// We deliberately expose only the small surface the renderer needs (no raw
// ipcRenderer, no node integration). This keeps the renderer secure (no
// access to Node APIs) while still giving connectDB() what it needs.

import { contextBridge, ipcRenderer } from 'electron'
import { CHANNEL, type MinnaldbBridge } from './protocol.js'

export function exposeMinnaldbBridge(): void {
  const bridge: MinnaldbBridge = {
    run: (req) => ipcRenderer.invoke(CHANNEL.run, req),
    first: (req) => ipcRenderer.invoke(CHANNEL.first, req),
    exec: (req) => ipcRenderer.invoke(CHANNEL.exec, req),
    subscribe: (req) => ipcRenderer.invoke(CHANNEL.subscribe, req),
    unsubscribe: (subId) => ipcRenderer.invoke(CHANNEL.unsubscribe, subId),
    onUpdate: (listener) => {
      // We wrap the listener so we can keep the unsubscribe function trivial
      // and avoid leaking the `event` object into user code.
      const wrapped = (_e: unknown, payload: unknown) => listener(payload as never)
      ipcRenderer.on(CHANNEL.update, wrapped)
      return () => {
        ipcRenderer.removeListener(CHANNEL.update, wrapped)
      }
    },
  }
  contextBridge.exposeInMainWorld('minnaldb', bridge)
}
