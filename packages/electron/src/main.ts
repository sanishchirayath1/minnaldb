// Main-process side of the IPC bridge. Registers handlers on a stable channel
// namespace and pushes subscription updates to the requesting renderer.
//
// Why we route updates back to the *requesting* renderer specifically (not all
// renderers): subscriptions are per-window. If two windows both subscribe to
// the same query, each gets its own subId and its own push channel — no shared
// state, no risk of cross-window leakage. Multi-window fan-out is left for v0.0.3.

import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import type { DB, Table } from 'minnaldb'
import {
  CHANNEL,
  type ExecResult,
  type RunRequest,
  type SubscribeRequest,
  type SubscribeResponse,
  type UpdatePush,
} from './protocol.js'

export interface ExposeDBOptions {
  /**
   * Channel namespace prefix. Defaults to "minnaldb:". Override only if you
   * need to expose multiple databases over IPC from the same process.
   */
  channelPrefix?: string
}

export interface ExposeDBHandle {
  /** Tear down all IPC handlers and active subscriptions. */
  dispose(): void
}

export function exposeDB<TSchema extends Record<string, Table<any, any>>>(
  db: DB<TSchema>,
  ipcMain: IpcMain,
  _opts: ExposeDBOptions = {},
): ExposeDBHandle {
  // subId → {unsubscribe, sender} so we can:
  //   (a) tear down a sub when the renderer asks (or when its window dies)
  //   (b) route pushes back to the sender
  const subs = new Map<string, { unsubscribe: () => void; sender: WebContents }>()
  let nextSubId = 1

  // When a window goes away (closed, crashed, navigated), drop its subs to
  // avoid leaking SubscriptionManager entries forever. Without this, every
  // window-reload during dev would orphan the previous subscription.
  const onSenderGone = (sender: WebContents) => {
    for (const [id, entry] of subs) {
      if (entry.sender === sender) {
        entry.unsubscribe()
        subs.delete(id)
      }
    }
  }

  const handleRun = async (_e: IpcMainInvokeEvent, req: RunRequest): Promise<unknown[]> => {
    return db.raw.prepare(req.query.sql).all(...req.query.params)
  }

  const handleFirst = async (_e: IpcMainInvokeEvent, req: RunRequest): Promise<unknown | null> => {
    const row = db.raw.prepare(req.query.sql).get(...req.query.params)
    return row ?? null
  }

  const handleExec = async (_e: IpcMainInvokeEvent, req: RunRequest): Promise<ExecResult> => {
    const info = db.raw.prepare(req.query.sql).run(...req.query.params)
    // Honour declared deps so subscribers get notified just like the in-process
    // executor would. depTables is required for write operations from the
    // renderer — the remote query builder always populates it.
    if (req.query.depTables.length > 0) {
      db.subscriptions.notify(req.query.depTables)
    }
    // Coerce bigint → number when safe so JSON serialisation across IPC works.
    // (Electron's IPC serialises with structured-clone-ish semantics that don't
    // handle bigint by default in older Electron versions.)
    const lastInsertRowid =
      typeof info.lastInsertRowid === 'bigint' && info.lastInsertRowid <= Number.MAX_SAFE_INTEGER
        ? Number(info.lastInsertRowid)
        : info.lastInsertRowid
    return { changes: info.changes, lastInsertRowid }
  }

  const handleSubscribe = async (
    e: IpcMainInvokeEvent,
    req: SubscribeRequest,
  ): Promise<SubscribeResponse> => {
    const subId = String(nextSubId++)
    const sender = e.sender
    // Hook the WebContents so we can clean up when it dies.
    sender.once('destroyed', () => onSenderGone(sender))

    let initial: unknown = undefined
    let initialCaptured = false
    const evaluate = () => db.raw.prepare(req.query.sql).all(...req.query.params)
    const callback = (value: unknown) => {
      if (!initialCaptured) {
        initial = value
        initialCaptured = true
        return
      }
      // Renderer may have closed the window between writes and the microtask
      // flush; check before sending to avoid Electron throwing.
      if (sender.isDestroyed()) return
      const payload: UpdatePush = { subId, value }
      sender.send(CHANNEL.update, payload)
    }
    const unsubscribe = db.subscriptions.subscribe(req.query.depTables, evaluate, callback)
    subs.set(subId, { unsubscribe, sender })
    return { subId, initial }
  }

  const handleUnsubscribe = async (_e: IpcMainInvokeEvent, subId: string): Promise<void> => {
    const entry = subs.get(subId)
    if (entry) {
      entry.unsubscribe()
      subs.delete(subId)
    }
  }

  ipcMain.handle(CHANNEL.run, handleRun)
  ipcMain.handle(CHANNEL.first, handleFirst)
  ipcMain.handle(CHANNEL.exec, handleExec)
  ipcMain.handle(CHANNEL.subscribe, handleSubscribe)
  ipcMain.handle(CHANNEL.unsubscribe, handleUnsubscribe)

  return {
    dispose() {
      ipcMain.removeHandler(CHANNEL.run)
      ipcMain.removeHandler(CHANNEL.first)
      ipcMain.removeHandler(CHANNEL.exec)
      ipcMain.removeHandler(CHANNEL.subscribe)
      ipcMain.removeHandler(CHANNEL.unsubscribe)
      for (const [, entry] of subs) entry.unsubscribe()
      subs.clear()
    },
  }
}
