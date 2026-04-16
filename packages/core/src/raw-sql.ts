import type Database from 'better-sqlite3'
import type { SubscriptionManager } from './subscriptions.js'
import type { WireQuery } from './compile.js'

/** Build a WireQuery from a tagged-template invocation. Pure; no DB needed. */
export function compileRaw(
  strings: TemplateStringsArray,
  values: unknown[],
  depTables: string[],
): WireQuery {
  const sql = strings.reduce((acc, part, i) => acc + part + (i < values.length ? '?' : ''), '')
  return { sql, params: values, depTables }
}

// Tagged template that produces a query handle. Interpolated values are bound
// as parameters, never spliced as text — there is no path here that builds SQL
// from string concatenation of user data.
//
// Usage:
//   const q = db.sql<{ id: number; n: number }>`
//     SELECT user_id as id, COUNT(*) as n FROM posts GROUP BY user_id
//   `.deps(['posts'])
//
//   await q.run()                  // one-shot
//   q.subscribe(rows => {...})     // reactive — re-runs on writes to `posts`

export interface RawSqlHandle<T> {
  /** Declare which tables this query depends on for invalidation purposes. */
  deps(tables: string[]): RawSqlHandle<T>
  /** Execute once and return rows (for SELECT) or the run info (for writes). */
  run(): T[]
  /** Execute once and return the first row, or null. */
  first(): T | null
  /** Execute as a write statement; returns better-sqlite3 RunResult-like info. */
  exec(): { changes: number; lastInsertRowid: number | bigint }
  /** Subscribe to changes. Throws if .deps() was not called. */
  subscribe(callback: (rows: T[]) => void): () => void
  toSQL(): WireQuery
}

export function makeRawSql(raw: Database.Database, subs: SubscriptionManager) {
  // The function form: db.sql<T>`...${a}...${b}...`
  return function sql<T = unknown>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): RawSqlHandle<T> {
    const sqlText = strings.reduce(
      (acc, part, i) => acc + part + (i < values.length ? '?' : ''),
      '',
    )
    let depsTables: string[] | undefined

    const handle: RawSqlHandle<T> = {
      deps(tables) {
        depsTables = tables
        return handle
      },
      run() {
        const stmt = raw.prepare(sqlText)
        return stmt.all(...values) as T[]
      },
      first() {
        const stmt = raw.prepare(sqlText)
        const row = stmt.get(...values) as T | undefined
        return row ?? null
      },
      exec() {
        const stmt = raw.prepare(sqlText)
        const info = stmt.run(...values)
        // Writes via raw SQL must declare deps so we know what to invalidate.
        // We err on the side of safety: if you skipped .deps(), we don't fire
        // any subscriptions, which can lead to stale UI. Force an explicit
        // choice rather than silently doing nothing.
        if (depsTables) {
          subs.notify(depsTables)
        } else {
          throw new Error(
            'minnaldb: raw SQL writes must declare affected tables via .deps([...]) ' +
              'so subscribers can be invalidated. If this is intentional (e.g., a ' +
              "PRAGMA), use db.raw().exec() to bypass invalidation entirely.",
          )
        }
        return { changes: info.changes, lastInsertRowid: info.lastInsertRowid as number | bigint }
      },
      subscribe(callback) {
        if (!depsTables) {
          throw new Error(
            'minnaldb: raw SQL subscriptions must declare table deps via .deps([...]) ' +
              "before .subscribe(). The query builder doesn't need this — only db.sql`...`.",
          )
        }
        return subs.subscribe(depsTables, () => handle.run(), callback)
      },
      toSQL() {
        return { sql: sqlText, params: values, depTables: depsTables ?? [] }
      },
    }
    return handle
  }
}
