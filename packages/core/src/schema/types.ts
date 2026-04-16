// Internal symbols keep the public type surface clean and prevent
// accidental access to runtime metadata from user code.
export const kColumn = Symbol('minnaldb.column')
export const kTable = Symbol('minnaldb.table')

export type SqliteAffinity = 'INTEGER' | 'TEXT' | 'REAL' | 'BLOB' | 'NUMERIC'

export type DefaultValue<T> = T | (() => T) | { sql: string }

export interface PendingReference {
  // Lambda to be invoked at DDL time, once all tables are registered.
  // We can't resolve the referenced column's table at column-define time
  // because tables may be declared in any order (or in cycles).
  ref: () => ColumnDef<any>
  onDelete?: 'cascade' | 'set null' | 'restrict'
}

export interface ColumnConfig<TJs = unknown> {
  name: string
  affinity: SqliteAffinity
  notNull: boolean
  unique: boolean
  primaryKey: boolean
  autoIncrement: boolean
  defaultValue: DefaultValue<TJs> | undefined
  reference: PendingReference | undefined
  // Phantom for type inference only — never set at runtime.
  _jsType?: TJs
}

export interface ColumnDef<TJs = unknown> {
  readonly [kColumn]: ColumnConfig<TJs>
  readonly name: string
  notNull(): ColumnDef<NonNullable<TJs>>
  unique(): ColumnDef<TJs>
  primaryKey(opts?: { autoIncrement?: boolean }): ColumnDef<NonNullable<TJs>>
  default(value: DefaultValue<TJs>): ColumnDef<TJs>
  references(
    ref: () => ColumnDef<any>,
    opts?: { onDelete?: 'cascade' | 'set null' | 'restrict' },
  ): ColumnDef<TJs>
}

export type ColumnsRecord = Record<string, ColumnDef<any>>

export interface TableConfig<TName extends string, TCols extends ColumnsRecord> {
  name: TName
  columns: TCols
}

// Tables expose their columns as direct properties so foreign-key lambdas
// can be written naturally: `references(() => users.id)`. The `_` and
// `[kTable]` fields hold the metadata used by codegen / introspection.
export type Table<TName extends string = string, TCols extends ColumnsRecord = ColumnsRecord> = TCols & {
  readonly [kTable]: TableConfig<TName, TCols>
  readonly _: { name: TName; columns: TCols }
}

// ─── Type inference ──────────────────────────────────────────────────────────
// Because Table is now a TCols & {meta} intersection, we extract the columns
// via conditional inference on the `_.columns` metadata field rather than by
// directly indexing the generic type (which TS can't always resolve).

type JsTypeOf<C> = C extends ColumnDef<infer T> ? T : never

type HasDefault<C> = C extends ColumnDef<any>
  ? C[typeof kColumn]['defaultValue'] extends undefined
    ? C[typeof kColumn]['autoIncrement'] extends true
      ? true
      : false
    : true
  : false

export type ColumnsOf<T> = T extends { _: { columns: infer C } }
  ? C extends ColumnsRecord
    ? C
    : never
  : never

export type InferSelect<T> = ColumnsOf<T> extends infer C
  ? C extends ColumnsRecord
    ? { [K in keyof C]: JsTypeOf<C[K]> }
    : never
  : never

export type InferInsert<T> = ColumnsOf<T> extends infer C
  ? C extends ColumnsRecord
    ? {
        [K in keyof C as HasDefault<C[K]> extends true ? never : K]: JsTypeOf<C[K]>
      } & {
        [K in keyof C as HasDefault<C[K]> extends true ? K : never]?: JsTypeOf<C[K]>
      }
    : never
  : never
