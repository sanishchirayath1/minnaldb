// Renderer-process side of the IPC bridge. Exposes a near-mirror of the
// in-process minnaldb API, but with all terminals returning Promises (since
// every operation must round-trip through IPC to the main process where the
// real database lives).
//
// Key implementation choice: the renderer compiles SQL itself, using the same
// pure compile* functions from core. This means:
//   • The query builder chain (.where/.orderBy/etc.) runs synchronously, with
//     no IPC. Building a query is free.
//   • The compiled WireQuery {sql, params, depTables} is shipped to main only
//     when a terminal is invoked.
//   • Subscriptions and one-shot reads share the exact same SQL — fewer code
//     paths to keep aligned, fewer ways to drift.

// Use the `/wire` subpath: this is the pure, DB-driver-free subset of
// minnaldb's public API. Importing the default `minnaldb` entry would pull
// better-sqlite3 transitively into the renderer bundle, which doesn't have
// access to Node natives.
import {
  compileDelete,
  compileInsert,
  compileRaw,
  compileSelect,
  compileUpdate,
  emptySelectState,
  lookupColumnSqlName,
  makeColumnProxy,
  tableMeta,
  type ColumnDef,
  type ColumnRef,
  type ColumnsOf,
  type ColumnsRecord,
  type Expr,
  type InferInsert,
  type InferSelect,
  type SelectState,
  type Table,
  type WireQuery,
} from 'minnaldb/wire'
import type { ExecResult, MinnaldbBridge, UpdatePush } from './protocol.js'

// ─── Public types ────────────────────────────────────────────────────────────

type ColumnProxy<TCols extends ColumnsRecord> = {
  [K in keyof TCols]: TCols[K] extends ColumnDef<infer T> ? ColumnRef<T> : never
}

export interface RemoteSelectQuery<TTable extends Table<any, any>> {
  where(predicate: (cols: ColumnProxy<ColumnsOf<TTable>>) => Expr): RemoteSelectQuery<TTable>
  orderBy(
    selector: (cols: ColumnProxy<ColumnsOf<TTable>>) => ColumnRef<unknown>,
    direction?: 'asc' | 'desc',
  ): RemoteSelectQuery<TTable>
  limit(n: number): RemoteSelectQuery<TTable>
  offset(n: number): RemoteSelectQuery<TTable>
  run(): Promise<InferSelect<TTable>[]>
  first(): Promise<InferSelect<TTable> | null>
  /**
   * Subscribe to result changes. Returns the unsubscribe function synchronously.
   * The first callback fire is asynchronous (it waits for the initial value
   * round-trip to main). React's useQuery already handles this by starting in
   * `loading: true` until the first value arrives.
   */
  subscribe(callback: (value: InferSelect<TTable>[]) => void): () => void
  toSQL(): WireQuery
}

export interface RemoteInsertBuilder<TTable extends Table<any, any>> {
  values(row: InferInsert<TTable> | InferInsert<TTable>[]): Promise<ExecResult>
}

export interface RemoteUpdateBuilder<TTable extends Table<any, any>> {
  set(values: Partial<InferInsert<TTable>>): {
    where(
      predicate: (cols: ColumnProxy<ColumnsOf<TTable>>) => Expr,
    ): Promise<{ changes: number }>
  }
}

export interface RemoteDeleteBuilder<TTable extends Table<any, any>> {
  where(
    predicate: (cols: ColumnProxy<ColumnsOf<TTable>>) => Expr,
  ): Promise<{ changes: number }>
}

export interface RemoteRawSqlHandle<T> {
  deps(tables: string[]): RemoteRawSqlHandle<T>
  run(): Promise<T[]>
  first(): Promise<T | null>
  exec(): Promise<ExecResult>
  subscribe(callback: (rows: T[]) => void): () => void
  toSQL(): WireQuery
}

export type RemoteDB<TSchema extends Record<string, Table<any, any>>> = {
  query: { [K in keyof TSchema]: RemoteSelectQuery<TSchema[K]> }
  insert<K extends keyof TSchema>(table: TSchema[K]): RemoteInsertBuilder<TSchema[K]>
  update<K extends keyof TSchema>(table: TSchema[K]): RemoteUpdateBuilder<TSchema[K]>
  delete<K extends keyof TSchema>(table: TSchema[K]): RemoteDeleteBuilder<TSchema[K]>
  sql: <T = unknown>(strings: TemplateStringsArray, ...values: unknown[]) => RemoteRawSqlHandle<T>
  /** Reserved for v0.0.3. Throws today. */
  transaction<T>(fn: () => T | Promise<T>): Promise<T>
}

// ─── Implementation ──────────────────────────────────────────────────────────

export function connectDB<TSchema extends Record<string, Table<any, any>>>(
  schema: TSchema,
  bridge: MinnaldbBridge = requireBridge(),
): RemoteDB<TSchema> {
  // Multiplex incoming push events by subId. Listeners register here; pushes
  // get fanned out to the matching listener (if any).
  const pushListeners = new Map<string, (value: unknown) => void>()
  bridge.onUpdate((payload: UpdatePush) => {
    const listener = pushListeners.get(payload.subId)
    if (listener) listener(payload.value)
  })

  // Build the typed query namespace lazily-but-once. Each access returns a
  // fresh chain so users can build multiple queries from the same entry point
  // without state bleeding between them — same semantics as the local DB.
  const queryNs = {} as { [K in keyof TSchema]: RemoteSelectQuery<TSchema[K]> }
  for (const key of Object.keys(schema) as (keyof TSchema)[]) {
    Object.defineProperty(queryNs, key, {
      enumerable: true,
      get: () => buildRemoteSelect(bridge, schema[key]!, emptySelectState(), pushListeners),
    })
  }

  return {
    query: queryNs,
    insert: (t) => makeRemoteInsert(bridge, t),
    update: (t) => makeRemoteUpdate(bridge, t),
    delete: (t) => makeRemoteDelete(bridge, t),
    sql: makeRemoteRawSql(bridge, pushListeners),
    transaction() {
      throw new Error(
        'minnaldb-electron: transactions across IPC are not yet supported. ' +
          'Plan your writes so each is independently atomic, or use the in-process ' +
          'minnaldb API in the main process.',
      )
    },
  }
}

function requireBridge(): MinnaldbBridge {
  if (typeof window === 'undefined' || !window.minnaldb) {
    throw new Error(
      'minnaldb-electron: window.minnaldb not found. Did you forget to call ' +
        'exposeMinnaldbBridge() in your preload script?',
    )
  }
  return window.minnaldb
}

function buildRemoteSelect<TTable extends Table<any, any>>(
  bridge: MinnaldbBridge,
  table: TTable,
  state: SelectState,
  pushListeners: Map<string, (value: unknown) => void>,
): RemoteSelectQuery<TTable> {
  const meta = tableMeta(table)
  const cols = makeColumnProxy(meta.columns) as ColumnProxy<ColumnsOf<TTable>>
  const wire = (): WireQuery => compileSelect(meta, state)

  const q: RemoteSelectQuery<TTable> = {
    where(predicate) {
      const expr = predicate(cols)
      return buildRemoteSelect(bridge, table, {
        ...state,
        whereClauses: [...state.whereClauses, expr],
      }, pushListeners)
    },
    orderBy(selector, direction = 'asc') {
      const target = selector(cols)
      const colName = lookupColumnSqlName(meta.columns, cols, target)
      if (!colName) {
        throw new Error('minnaldb: orderBy selector must return a column from this table')
      }
      return buildRemoteSelect(bridge, table, {
        ...state,
        orderBys: [...state.orderBys, { col: colName, dir: direction }],
      }, pushListeners)
    },
    limit(n) {
      return buildRemoteSelect(bridge, table, { ...state, limitN: n }, pushListeners)
    },
    offset(n) {
      return buildRemoteSelect(bridge, table, { ...state, offsetN: n }, pushListeners)
    },
    async run() {
      const rows = await bridge.run({ query: wire() })
      return rows as InferSelect<TTable>[]
    },
    async first() {
      const row = await bridge.first({ query: wire() })
      return (row ?? null) as InferSelect<TTable> | null
    },
    subscribe(callback) {
      return startSubscription(bridge, wire(), pushListeners, callback as (v: unknown) => void)
    },
    toSQL: wire,
  }
  return q
}

function makeRemoteInsert<TTable extends Table<any, any>>(
  bridge: MinnaldbBridge,
  table: TTable,
): RemoteInsertBuilder<TTable> {
  return {
    async values(row) {
      const list = (Array.isArray(row) ? row : [row]) as Record<string, unknown>[]
      if (list.length === 0) return { changes: 0, lastInsertRowid: 0 }
      const wire = compileInsert(table, list)
      return bridge.exec({ query: wire })
    },
  }
}

function makeRemoteUpdate<TTable extends Table<any, any>>(
  bridge: MinnaldbBridge,
  table: TTable,
): RemoteUpdateBuilder<TTable> {
  const proxy = makeColumnProxy(tableMeta(table).columns) as unknown as ColumnProxy<ColumnsOf<TTable>>
  return {
    set(values) {
      return {
        async where(predicate) {
          const expr = predicate(proxy)
          const wire = compileUpdate(table, values as Record<string, unknown>, expr)
          const r = await bridge.exec({ query: wire })
          return { changes: r.changes }
        },
      }
    },
  }
}

function makeRemoteDelete<TTable extends Table<any, any>>(
  bridge: MinnaldbBridge,
  table: TTable,
): RemoteDeleteBuilder<TTable> {
  const proxy = makeColumnProxy(tableMeta(table).columns) as unknown as ColumnProxy<ColumnsOf<TTable>>
  return {
    async where(predicate) {
      const expr = predicate(proxy)
      const wire = compileDelete(table, expr)
      const r = await bridge.exec({ query: wire })
      return { changes: r.changes }
    },
  }
}

function makeRemoteRawSql(
  bridge: MinnaldbBridge,
  pushListeners: Map<string, (value: unknown) => void>,
) {
  return function sql<T = unknown>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): RemoteRawSqlHandle<T> {
    let depTables: string[] = []
    const wire = (): WireQuery => compileRaw(strings, values, depTables)

    const handle: RemoteRawSqlHandle<T> = {
      deps(tables) {
        depTables = tables
        return handle
      },
      async run() {
        const rows = await bridge.run({ query: wire() })
        return rows as T[]
      },
      async first() {
        const row = await bridge.first({ query: wire() })
        return (row ?? null) as T | null
      },
      async exec() {
        if (depTables.length === 0) {
          throw new Error(
            'minnaldb-electron: raw SQL writes must declare affected tables via ' +
              '.deps([...]) so subscribers can be invalidated.',
          )
        }
        return bridge.exec({ query: wire() })
      },
      subscribe(callback) {
        if (depTables.length === 0) {
          throw new Error(
            'minnaldb-electron: raw SQL subscriptions must declare table deps via ' +
              '.deps([...]) before .subscribe().',
          )
        }
        return startSubscription(bridge, wire(), pushListeners, callback as (v: unknown) => void)
      },
      toSQL: wire,
    }
    return handle
  }
}

// Shared subscription bootstrapping for both typed selects and raw SQL handles.
//
// Returns the unsubscribe function synchronously. Internally:
//   • Sends subscribe IPC; gets back {subId, initial}.
//   • Fires the callback with `initial` immediately on resolution.
//   • Registers a push listener for subId; subsequent callback fires happen
//     when main pushes updates.
//   • If unsubscribe is called before subId arrives, marks cancelled and tears
//     down once the subId is known.
function startSubscription(
  bridge: MinnaldbBridge,
  query: WireQuery,
  pushListeners: Map<string, (value: unknown) => void>,
  callback: (value: unknown) => void,
): () => void {
  let cancelled = false
  let subId: string | undefined

  bridge.subscribe({ query }).then(
    (resp) => {
      if (cancelled) {
        // User unsubscribed before initial value arrived — tear down server-side.
        bridge.unsubscribe(resp.subId).catch(() => {})
        return
      }
      subId = resp.subId
      pushListeners.set(resp.subId, callback)
      callback(resp.initial)
    },
    (err) => {
      // Subscribe IPC itself failed — surface via console; React boundaries
      // can't catch async errors from outside their tree.
      console.error('minnaldb-electron: subscribe failed', err)
    },
  )

  return () => {
    cancelled = true
    if (subId !== undefined) {
      pushListeners.delete(subId)
      bridge.unsubscribe(subId).catch(() => {})
    }
  }
}
