// Pure SQL compilation — produces serializable {sql, params, depTables}
// triples that any executor (better-sqlite3 in-process, IPC bridge to a remote
// process, etc.) can run. By keeping this layer free of database handles and
// subscription managers, the same compile functions are used by:
//   • the in-process executor in db.ts (Node, sync)
//   • the renderer-side proxy in packages/electron (IPC, async)
//
// Every compiled query carries `depTables` so subscription invalidation works
// uniformly: the executor just hands depTables to the SubscriptionManager.

import { kColumn, type ColumnDef, type ColumnsRecord, type Table, type TableConfig, tableMeta } from './schema/index.js'
import { quoteIdent } from './ddl.js'
import { renderExpr, type Expr } from './expr.js'

/** Serializable description of a SQL operation, safe to send across IPC. */
export interface WireQuery {
  sql: string
  params: unknown[]
  /** Tables this query reads from / writes to — drives subscription invalidation. */
  depTables: string[]
}

// ─── SELECT ──────────────────────────────────────────────────────────────────

export interface SelectState {
  whereClauses: Expr[]
  orderBys: { col: string; dir: 'asc' | 'desc' }[]
  limitN: number | undefined
  offsetN: number | undefined
}

export function emptySelectState(): SelectState {
  return { whereClauses: [], orderBys: [], limitN: undefined, offsetN: undefined }
}

export function compileSelect(
  meta: TableConfig<string, ColumnsRecord>,
  state: SelectState,
): WireQuery {
  const params: unknown[] = []
  // Emit explicit column list so SQL column names are aliased back to JS keys.
  // Without this, a column defined as `createdAt: integer('created_at')` would
  // appear as `created_at` in result rows, causing a mismatch with InferSelect.
  const selectCols = Object.entries(meta.columns)
    .map(([jsKey, col]) => {
      const sqlName = col[kColumn].name
      if (sqlName === jsKey) return quoteIdent(sqlName)
      return `${quoteIdent(sqlName)} AS ${quoteIdent(jsKey)}`
    })
    .join(', ')
  const parts: string[] = [`SELECT ${selectCols} FROM ${quoteIdent(meta.name)}`]
  if (state.whereClauses.length > 0) {
    const renderedWheres = state.whereClauses.map((w) => {
      const r = renderExpr(w)
      params.push(...r.params)
      return r.sql
    })
    parts.push('WHERE ' + renderedWheres.join(' AND '))
  }
  if (state.orderBys.length > 0) {
    parts.push(
      'ORDER BY ' + state.orderBys.map((o) => `${quoteIdent(o.col)} ${o.dir.toUpperCase()}`).join(', '),
    )
  }
  if (state.limitN !== undefined) parts.push(`LIMIT ${state.limitN | 0}`)
  if (state.offsetN !== undefined) parts.push(`OFFSET ${state.offsetN | 0}`)
  return { sql: parts.join(' '), params, depTables: [meta.name] }
}

// ─── INSERT / UPDATE / DELETE ─────────────────────────────────────────────────
// These take a Table (not just metadata) because INSERT applies JS function
// defaults from column configs. The compile layer is still pure: it doesn't
// touch better-sqlite3 or any subscription state.

function applyFunctionDefaults(cols: ColumnsRecord, values: Record<string, unknown>): Record<string, unknown> {
  const out = { ...values }
  for (const [key, col] of Object.entries(cols)) {
    if (out[key] !== undefined) continue
    const def = col[kColumn].defaultValue
    if (typeof def === 'function') {
      out[key] = (def as () => unknown)()
    }
  }
  return out
}

export function compileInsert<TTable extends Table<any, any>>(
  table: TTable,
  rows: Record<string, unknown> | Record<string, unknown>[],
): WireQuery {
  const meta = tableMeta(table)
  const tName = meta.name
  const colDefs = meta.columns
  const list = Array.isArray(rows) ? rows : [rows]
  if (list.length === 0) {
    // Empty insert is valid but produces no SQL — caller handles this.
    return { sql: '', params: [], depTables: [tName] }
  }

  const filled = list.map((r) => applyFunctionDefaults(colDefs, r))
  const colKeys = Object.keys(filled[0]!)
  const sqlCols = colKeys.map((k) => {
    const def = colDefs[k]
    if (!def) throw new Error(`minnaldb: unknown column "${k}" on table "${tName}"`)
    return def[kColumn].name
  })
  const placeholders = `(${sqlCols.map(() => '?').join(', ')})`
  const sql = `INSERT INTO ${quoteIdent(tName)} (${sqlCols.map(quoteIdent).join(', ')}) VALUES ${list
    .map(() => placeholders)
    .join(', ')}`

  const params: unknown[] = []
  for (const r of filled) for (const k of colKeys) params.push(r[k])
  return { sql, params, depTables: [tName] }
}

export function compileUpdate<TTable extends Table<any, any>>(
  table: TTable,
  values: Record<string, unknown>,
  whereExpr: Expr,
): WireQuery {
  const meta = tableMeta(table)
  const tName = meta.name
  const colDefs = meta.columns
  const valueEntries = Object.entries(values)
  if (valueEntries.length === 0) {
    throw new Error('minnaldb: update().set() requires at least one column')
  }
  const setSql = valueEntries
    .map(([key]) => {
      const def = colDefs[key]
      if (!def) throw new Error(`minnaldb: unknown column "${key}" on table "${tName}"`)
      return `${quoteIdent(def[kColumn].name)} = ?`
    })
    .join(', ')
  const setParams = valueEntries.map(([, v]) => v)
  const { sql: whereSql, params: whereParams } = renderExpr(whereExpr)
  const sql = `UPDATE ${quoteIdent(tName)} SET ${setSql} WHERE ${whereSql}`
  return { sql, params: [...setParams, ...whereParams], depTables: [tName] }
}

export function compileDelete<TTable extends Table<any, any>>(
  table: TTable,
  whereExpr: Expr,
): WireQuery {
  const tName = tableMeta(table).name
  const { sql: whereSql, params } = renderExpr(whereExpr)
  return { sql: `DELETE FROM ${quoteIdent(tName)} WHERE ${whereSql}`, params, depTables: [tName] }
}

// ─── Column-by-key reverse lookup ─────────────────────────────────────────────
// orderBy() in the chain takes a selector that returns a ColumnRef; we need to
// recover the SQL column name. The trick (iterating the proxy to find identity
// match) is shared between local and remote builders, so we extract it here.

export function lookupColumnSqlName(
  cols: ColumnsRecord,
  proxy: Record<string, unknown>,
  target: unknown,
): string | undefined {
  for (const [key, ref] of Object.entries(proxy)) {
    if (ref === target) {
      const def = cols[key] as ColumnDef<unknown> | undefined
      if (def) return def[kColumn].name
    }
  }
  return undefined
}
