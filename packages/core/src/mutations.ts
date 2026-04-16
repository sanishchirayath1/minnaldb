import type Database from 'better-sqlite3'
import {
  type ColumnDef,
  type ColumnsOf,
  type ColumnsRecord,
  type InferInsert,
  type Table,
  tableMeta,
} from './schema/index.js'
import { colRef, renderExpr, type ColumnRef, type Expr } from './expr.js'
import type { SubscriptionManager } from './subscriptions.js'
import { compileDelete, compileInsert, compileUpdate } from './compile.js'

// Same column proxy shape as in query.ts. Defined locally rather than imported
// to keep mutations.ts free of cross-file type churn during the refactor.
type ColumnProxy<TCols extends ColumnsRecord> = {
  [K in keyof TCols]: TCols[K] extends ColumnDef<infer T> ? ColumnRef<T> : never
}

export interface InsertResult {
  lastInsertRowid: number | bigint
  changes: number
}

// Build a {colKey: ColumnRef<T>} proxy from a table. Typed loosely here
// because the public API of update().where() / delete().where() accepts any
// boolean-ish Expr — per-column type narrowing isn't needed for v0.1.
function makeColumnProxy(table: Table<any, any>): Record<string, ColumnRef<unknown>> {
  const out: Record<string, ColumnRef<unknown>> = {}
  for (const [key, col] of Object.entries(tableMeta(table).columns)) {
    out[key] = colRef(col)
  }
  return out
}

export function insertInto<TTable extends Table<any, any>>(
  raw: Database.Database,
  subs: SubscriptionManager,
  table: TTable,
) {
  return {
    values(row: InferInsert<TTable> | InferInsert<TTable>[]): InsertResult {
      const list = Array.isArray(row) ? row : [row]
      if (list.length === 0) return { lastInsertRowid: 0, changes: 0 }
      const wire = compileInsert(table, list as Record<string, unknown>[])
      const info = raw.prepare(wire.sql).run(...wire.params)
      subs.notify(wire.depTables)
      return { lastInsertRowid: info.lastInsertRowid as number | bigint, changes: info.changes }
    },
  }
}

export function updateTable<TTable extends Table<any, any>>(
  raw: Database.Database,
  subs: SubscriptionManager,
  table: TTable,
) {
  // Two-step builder: .set(...).where(...) — where is required for safety.
  // We considered allowing where-less updates but they're almost always bugs.
  return {
    set(values: Partial<InferInsert<TTable>>) {
      return {
        where(
          predicate: (cols: ColumnProxy<ColumnsOf<TTable>>) => Expr,
        ): { changes: number } {
          const proxy = makeColumnProxy(table) as unknown as ColumnProxy<ColumnsOf<TTable>>
          const expr = predicate(proxy)
          const wire = compileUpdate(table, values as Record<string, unknown>, expr)
          const info = raw.prepare(wire.sql).run(...wire.params)
          subs.notify(wire.depTables)
          return { changes: info.changes }
        },
      }
    },
  }
}

export function deleteFrom<TTable extends Table<any, any>>(
  raw: Database.Database,
  subs: SubscriptionManager,
  table: TTable,
) {
  return {
    where(predicate: (cols: ColumnProxy<ColumnsOf<TTable>>) => Expr): { changes: number } {
      const proxy = makeColumnProxy(table) as unknown as ColumnProxy<ColumnsOf<TTable>>
      const wire = compileDelete(table, predicate(proxy))
      const info = raw.prepare(wire.sql).run(...wire.params)
      subs.notify(wire.depTables)
      return { changes: info.changes }
    },
  }
}

// Re-export to discourage importing from internal paths.
export { renderExpr }
