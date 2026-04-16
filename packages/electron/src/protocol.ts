// Wire protocol shared by main and renderer. A single source of truth means
// channel names and payload shapes can't drift between the two sides.
//
// Design notes:
//   • Every operation crosses IPC as a `WireQuery` ({sql, params, depTables}).
//     This means the renderer compiles SQL locally (using the same compile
//     functions as the in-process executor), then ships only data — no JS
//     functions, no proxy objects.
//   • Subscriptions are referenced by string `subId` (not numeric) so they
//     don't collide if multiple windows talk to the same main process.
//   • Push notifications use a single channel (`update`) with subId in payload,
//     so the renderer multiplexes them itself.

import type { WireQuery } from 'minnaldb'

export const CHANNEL = {
  /** SELECT-style: returns rows. */
  run: 'minnaldb:run',
  /** SELECT first: returns one row or null. */
  first: 'minnaldb:first',
  /** Write: returns {changes, lastInsertRowid}. */
  exec: 'minnaldb:exec',
  /** Subscribe: returns {subId, initial}. */
  subscribe: 'minnaldb:subscribe',
  /** Tear down a subscription. */
  unsubscribe: 'minnaldb:unsubscribe',
  /** Push: main → renderer when a sub re-evaluates. */
  update: 'minnaldb:update',
} as const

export interface RunRequest {
  query: WireQuery
}

export interface ExecResult {
  changes: number
  lastInsertRowid: number | bigint
}

export interface SubscribeRequest {
  query: WireQuery
}

export interface SubscribeResponse {
  subId: string
  initial: unknown
}

export interface UpdatePush {
  subId: string
  value: unknown
}

/** What the renderer expects on `window.minnaldb` after the preload runs. */
export interface MinnaldbBridge {
  run(req: RunRequest): Promise<unknown[]>
  first(req: RunRequest): Promise<unknown | null>
  exec(req: RunRequest): Promise<ExecResult>
  subscribe(req: SubscribeRequest): Promise<SubscribeResponse>
  unsubscribe(subId: string): Promise<void>
  /** Returns a function that detaches the listener. */
  onUpdate(listener: (payload: UpdatePush) => void): () => void
}

declare global {
  interface Window {
    minnaldb?: MinnaldbBridge
  }
}
