export { createDB, type CreateDBOptions, type DB } from './db.js'
export { and, or, not, type Expr, type ColumnRef } from './expr.js'
export { SubscriptionManager, deepEqual } from './subscriptions.js'
export type { SelectQuery, QueryHandle } from './query.js'
export { makeColumnProxy } from './query.js'
export type { RawSqlHandle } from './raw-sql.js'
export { compileRaw } from './raw-sql.js'
export type { InsertResult } from './mutations.js'

// Pure SQL compilation — used by both the in-process executor and the IPC
// renderer-side proxy in packages/electron.
export {
  compileSelect,
  compileInsert,
  compileUpdate,
  compileDelete,
  emptySelectState,
  lookupColumnSqlName,
  type WireQuery,
  type SelectState,
} from './compile.js'

// Re-export schema essentials at the root for convenience.
export {
  text,
  integer,
  real,
  blob,
  sqliteTable,
  tableMeta,
  type ColumnDef,
  type ColumnsOf,
  type ColumnsRecord,
  type Table,
  type InferSelect,
  type InferInsert,
} from './schema/index.js'
