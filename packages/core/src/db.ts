import BetterSqlite3 from 'better-sqlite3'
import type Database from 'better-sqlite3'
import { generateSchemaDDL } from './ddl.js'
import { resolveSchema, type Table } from './schema/index.js'
import { SubscriptionManager } from './subscriptions.js'
import { makeSelect, type SelectQuery } from './query.js'
import { deleteFrom, insertInto, updateTable } from './mutations.js'
import { makeRawSql } from './raw-sql.js'

export interface CreateDBOptions<TSchema extends Record<string, Table<any, any>>> {
  /** File path or `:memory:`. Passed straight to better-sqlite3. */
  path: string
  /** Schema record from `sqliteTable()` calls. */
  schema: TSchema
  /** Pass-through better-sqlite3 options. */
  driver?: BetterSqlite3.Options
  /** When true (default), runs `PRAGMA foreign_keys = ON` after open. */
  enableForeignKeys?: boolean
  /** When true (default), runs `PRAGMA journal_mode = WAL` for better concurrent reads. */
  walMode?: boolean
}

export type DB<TSchema extends Record<string, Table<any, any>>> = {
  /** Typed query builder, one entry per table. `db.query.users.where(...)`. */
  query: { [K in keyof TSchema]: SelectQuery<TSchema[K]> }
  insert<K extends keyof TSchema>(table: TSchema[K]): ReturnType<typeof insertInto<TSchema[K]>>
  update<K extends keyof TSchema>(table: TSchema[K]): ReturnType<typeof updateTable<TSchema[K]>>
  delete<K extends keyof TSchema>(table: TSchema[K]): ReturnType<typeof deleteFrom<TSchema[K]>>
  /** Raw SQL escape hatch. Tagged template; values are bound, not spliced. */
  sql: ReturnType<typeof makeRawSql>
  /**
   * Atomic transaction. Subscribers see writes once, on commit. If the callback
   * throws, the transaction rolls back and no invalidation fires.
   */
  transaction<T>(fn: () => T): T
  /** Underlying better-sqlite3 handle. Use sparingly — bypasses invalidation. */
  raw: Database.Database
  /** Subscription manager — exposed for advanced uses (manual notify, flushSync in tests). */
  subscriptions: SubscriptionManager
  /** Close the database. */
  close(): void
}

export function createDB<TSchema extends Record<string, Table<any, any>>>(
  opts: CreateDBOptions<TSchema>,
): DB<TSchema> {
  const raw = new BetterSqlite3(opts.path, opts.driver ?? {})
  if (opts.walMode !== false && opts.path !== ':memory:') {
    raw.pragma('journal_mode = WAL')
  }
  if (opts.enableForeignKeys !== false) {
    raw.pragma('foreign_keys = ON')
  }

  const { columnToTable } = resolveSchema(opts.schema)
  const ddl = generateSchemaDDL(opts.schema, columnToTable)
  raw.exec(ddl)

  const subs = new SubscriptionManager()

  // Build the typed query namespace lazily-but-once. Each entry is a fresh
  // SelectQuery whose chain methods return new queries — see query.ts.
  const queryNs = {} as { [K in keyof TSchema]: SelectQuery<TSchema[K]> }
  for (const key of Object.keys(opts.schema) as (keyof TSchema)[]) {
    Object.defineProperty(queryNs, key, {
      enumerable: true,
      get: () => makeSelect(raw, subs, opts.schema[key]!),
    })
  }

  const sql = makeRawSql(raw, subs)

  const db: DB<TSchema> = {
    query: queryNs,
    insert: (t) => insertInto(raw, subs, t),
    update: (t) => updateTable(raw, subs, t),
    delete: (t) => deleteFrom(raw, subs, t),
    sql,
    transaction(fn) {
      // We use better-sqlite3's transaction wrapper for the SQL-level atomicity
      // and our own SubscriptionManager.beginTransaction() for invalidation
      // batching. Both must align: notify is buffered into txTables during the
      // tx, then released on commit.
      subs.beginTransaction()
      const wrapped = raw.transaction(fn as () => unknown)
      try {
        const result = wrapped() as ReturnType<typeof fn>
        subs.commitTransaction()
        return result
      } catch (err) {
        // better-sqlite3 already rolled back the SQL transaction by the time
        // it rethrew; we just need to discard buffered invalidations.
        subs.rollbackTransaction()
        throw err
      }
    },
    raw,
    subscriptions: subs,
    close() {
      raw.close()
    },
  }
  return db
}
