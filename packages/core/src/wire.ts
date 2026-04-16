// Pure subset of the public API — safe to import from environments that
// CANNOT load better-sqlite3 (e.g. an Electron renderer process, a web
// worker, or a browser bundle proxying to a server).
//
// Importing from `minnaldb` (the default entry) transitively loads
// better-sqlite3 via db.ts. That's fine in main/Node but breaks renderer
// bundles. Anything in this file is guaranteed to be DB-driver-free.

export { and, or, not, type Expr, type ColumnRef } from './expr.js'
export type { SelectQuery, QueryHandle } from './query.js'
export { makeColumnProxy } from './query.js'
export type { RawSqlHandle } from './raw-sql.js'
export { compileRaw } from './raw-sql.js'

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
