import type Database from 'better-sqlite3'
import {
  type ColumnDef,
  type ColumnsOf,
  type ColumnsRecord,
  type InferSelect,
  type Table,
  tableMeta,
} from './schema/index.js'
import { colRef, type ColumnRef, type Expr } from './expr.js'
import type { SubscriptionManager } from './subscriptions.js'
import {
  compileSelect,
  emptySelectState,
  lookupColumnSqlName,
  type SelectState,
  type WireQuery,
} from './compile.js'

// A "column proxy" for a table — turns the schema's ColumnDef record into a
// record of ColumnRef so users write `u => u.email.like('%')` instead of the
// more verbose `colRef(users.email).like('%')`.
type ColumnProxy<TCols extends ColumnsRecord> = {
  [K in keyof TCols]: TCols[K] extends ColumnDef<infer T> ? ColumnRef<T> : never
}

export function makeColumnProxy<TCols extends ColumnsRecord>(cols: TCols): ColumnProxy<TCols> {
  const out: Record<string, ColumnRef<unknown>> = {}
  for (const [key, col] of Object.entries(cols)) {
    out[key] = colRef(col)
  }
  return out as ColumnProxy<TCols>
}

export interface QueryHandle<T> {
  toSQL(): WireQuery
  run(): T
  subscribe(callback: (value: T) => void): () => void
}

export interface SelectQuery<TTable extends Table<any, any>> {
  where(predicate: (cols: ColumnProxy<ColumnsOf<TTable>>) => Expr): SelectQuery<TTable>
  orderBy(
    selector: (cols: ColumnProxy<ColumnsOf<TTable>>) => ColumnRef<unknown>,
    direction?: 'asc' | 'desc',
  ): SelectQuery<TTable>
  limit(n: number): SelectQuery<TTable>
  offset(n: number): SelectQuery<TTable>
  // Default execution: array of rows.
  run(): InferSelect<TTable>[]
  // Convenience: first row or null.
  first(): InferSelect<TTable> | null
  subscribe(callback: (value: InferSelect<TTable>[]) => void): () => void
  toSQL(): WireQuery
}

export function makeSelect<TTable extends Table<any, any>>(
  raw: Database.Database,
  subs: SubscriptionManager,
  table: TTable,
): SelectQuery<TTable> {
  return buildSelect(raw, subs, table, emptySelectState())
}

function buildSelect<TTable extends Table<any, any>>(
  raw: Database.Database,
  subs: SubscriptionManager,
  table: TTable,
  state: SelectState,
): SelectQuery<TTable> {
  const meta = tableMeta(table)
  const tName = meta.name
  // Cast to the user-facing typed proxy. tableMeta() returns the loose
  // ColumnsRecord shape (the metadata isn't generic), but at runtime each
  // column matches the table's actual columns one-to-one.
  const cols = makeColumnProxy(meta.columns) as ColumnProxy<ColumnsOf<TTable>>

  const compile = (): WireQuery => compileSelect(meta, state)

  const run = (): InferSelect<TTable>[] => {
    const { sql, params } = compile()
    const stmt = raw.prepare(sql)
    return stmt.all(...params) as InferSelect<TTable>[]
  }

  const q: SelectQuery<TTable> = {
    where(predicate) {
      const expr = predicate(cols)
      return buildSelect(raw, subs, table, {
        ...state,
        whereClauses: [...state.whereClauses, expr],
      })
    },
    orderBy(selector, direction = 'asc') {
      const target = selector(cols)
      const colName = lookupColumnSqlName(meta.columns, cols, target)
      if (!colName) {
        throw new Error('minnaldb: orderBy selector must return a column from this table')
      }
      return buildSelect(raw, subs, table, {
        ...state,
        orderBys: [...state.orderBys, { col: colName, dir: direction }],
      })
    },
    limit(n) {
      return buildSelect(raw, subs, table, { ...state, limitN: n })
    },
    offset(n) {
      return buildSelect(raw, subs, table, { ...state, offsetN: n })
    },
    run,
    first() {
      const { sql, params } = compile()
      const stmt = raw.prepare(sql)
      const row = stmt.get(...params) as InferSelect<TTable> | undefined
      return row ?? null
    },
    subscribe(callback) {
      return subs.subscribe([tName], run, callback)
    },
    toSQL: compile,
  }
  return q
}
