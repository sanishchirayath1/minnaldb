// The subscription engine is the heart of minnaldb's reactivity.
//
// Design choices:
//
// 1. **Table-level invalidation.** A subscription declares the set of tables it
//    reads. A mutation declares the set of tables it writes. If those sets
//    intersect, the subscription is re-evaluated. This is coarse but correct —
//    it can produce false positives (a write to a row the query doesn't care
//    about will trigger a re-run) but never false negatives. Row-level
//    precision is a future upgrade; we deliberately don't try to parse SQL.
//
// 2. **Coalescing.** Multiple writes inside the same microtask collapse into a
//    single re-evaluation per affected subscription. This makes loops, batch
//    inserts, and React state updates cheap by default. We use queueMicrotask
//    so the re-runs happen *after* the current synchronous code finishes but
//    *before* the next macrotask (timers, I/O), which matches what UI code
//    expects.
//
// 3. **Result diffing.** A re-evaluation that produces a deep-equal result to
//    the previous one does not fire the callback. This means a mutation that
//    doesn't actually change a query's output is invisible to subscribers,
//    which prevents needless React re-renders downstream.
//
// 4. **Transactions.** During a transaction, table-write events are buffered
//    and only flushed on commit. On rollback, they are discarded. This means
//    subscribers never see mid-transaction state.

export interface SubscriptionEntry<T = unknown> {
  id: number
  tables: Set<string>
  evaluate: () => T
  callback: (value: T) => void
  lastValue: T | typeof UNSET
  // Whether this subscription is currently scheduled for re-evaluation.
  // Prevents duplicate work inside a single microtask flush.
  pending: boolean
}

const UNSET = Symbol('unset')

export class SubscriptionManager {
  private nextId = 1
  private subscriptions = new Map<number, SubscriptionEntry<any>>()

  // Pending invalidation set, drained on each microtask flush.
  private pendingTables = new Set<string>()
  private flushScheduled = false

  // Transaction state — when depth > 0, mutations are buffered into
  // `txTables` and only published to pendingTables on commit.
  private txDepth = 0
  private txTables = new Set<string>()

  subscribe<T>(
    tables: Iterable<string>,
    evaluate: () => T,
    callback: (value: T) => void,
  ): () => void {
    const id = this.nextId++
    const entry: SubscriptionEntry<T> = {
      id,
      tables: new Set(tables),
      evaluate,
      callback,
      lastValue: UNSET,
      pending: false,
    }
    this.subscriptions.set(id, entry)

    // Fire once synchronously so subscribers always have an initial value.
    // We catch errors here so a bad initial query doesn't tear down the
    // subscription registration — the callback receives the error via the
    // callback contract (callers can wrap evaluate to surface errors).
    try {
      const value = entry.evaluate()
      entry.lastValue = value
      callback(value)
    } catch (err) {
      // Re-throw so the caller sees setup errors immediately.
      this.subscriptions.delete(id)
      throw err
    }

    return () => {
      this.subscriptions.delete(id)
    }
  }

  // Called by mutations after they execute (or on transaction commit).
  // Adds the touched tables to the pending set and schedules a flush.
  notify(tables: Iterable<string>): void {
    if (this.txDepth > 0) {
      for (const t of tables) this.txTables.add(t)
      return
    }
    let added = false
    for (const t of tables) {
      if (!this.pendingTables.has(t)) {
        this.pendingTables.add(t)
        added = true
      }
    }
    if (added && !this.flushScheduled) {
      this.flushScheduled = true
      queueMicrotask(() => this.flush())
    }
  }

  beginTransaction(): void {
    this.txDepth++
  }

  commitTransaction(): void {
    if (this.txDepth === 0) {
      throw new Error('minnaldb: commitTransaction called without an active transaction')
    }
    this.txDepth--
    if (this.txDepth === 0 && this.txTables.size > 0) {
      const tables = Array.from(this.txTables)
      this.txTables.clear()
      this.notify(tables)
    }
  }

  rollbackTransaction(): void {
    if (this.txDepth === 0) {
      throw new Error('minnaldb: rollbackTransaction called without an active transaction')
    }
    this.txDepth--
    if (this.txDepth === 0) this.txTables.clear()
  }

  // For tests/debugging: synchronously drain pending invalidations.
  flushSync(): void {
    if (this.flushScheduled) {
      this.flushScheduled = false
      this.flush()
    }
  }

  private flush(): void {
    this.flushScheduled = false
    const tables = this.pendingTables
    if (tables.size === 0) return
    this.pendingTables = new Set()

    // Snapshot subscriptions so callbacks that subscribe/unsubscribe during
    // their own callback don't perturb the iteration. New subscriptions
    // created during this flush will simply not see *this* invalidation,
    // which is fine because they were created with a fresh value already.
    const toRun: SubscriptionEntry<any>[] = []
    for (const sub of this.subscriptions.values()) {
      if (sub.pending) continue
      let touched = false
      for (const t of tables) {
        if (sub.tables.has(t)) {
          touched = true
          break
        }
      }
      if (touched) {
        sub.pending = true
        toRun.push(sub)
      }
    }

    for (const sub of toRun) {
      sub.pending = false
      // If the subscription was unsubscribed between scheduling and running,
      // skip it. (Map.delete during the loop above is fine; we also re-check
      // here to handle unsubs that happened in earlier callbacks of this flush.)
      if (!this.subscriptions.has(sub.id)) continue
      let next: unknown
      try {
        next = sub.evaluate()
      } catch (err) {
        // Surface evaluation errors via the callback by re-throwing in a
        // microtask so they become unhandled rejections instead of taking
        // down the whole flush. Real apps should add an onError per-sub later.
        queueMicrotask(() => {
          throw err
        })
        continue
      }
      if (sub.lastValue !== UNSET && deepEqual(sub.lastValue, next)) continue
      sub.lastValue = next
      try {
        sub.callback(next)
      } catch (err) {
        queueMicrotask(() => {
          throw err
        })
      }
    }
  }
}

// Structural equality good enough for plain query results: arrays of objects
// with primitive/Date/Uint8Array fields. We intentionally avoid pulling in a
// dep — this stays inlined and predictable.
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  if (typeof a !== 'object' || typeof b !== 'object') return false
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  if (a instanceof Uint8Array && b instanceof Uint8Array) {
    if (a.byteLength !== b.byteLength) return false
    for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false
    return true
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false
    return true
  }
  if (Array.isArray(b)) return false
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  if (ka.length !== kb.length) return false
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false
  }
  return true
}
