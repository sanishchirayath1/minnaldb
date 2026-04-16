import { kColumn, type ColumnConfig, type ColumnDef, type DefaultValue, type SqliteAffinity } from './types.js'

function makeColumn<T>(name: string, affinity: SqliteAffinity): ColumnDef<T | null> {
  const cfg: ColumnConfig<T | null> = {
    name,
    affinity,
    notNull: false,
    unique: false,
    primaryKey: false,
    autoIncrement: false,
    defaultValue: undefined,
    reference: undefined,
  }
  return wrap<T | null>(cfg)
}

function wrap<T>(cfg: ColumnConfig<T>): ColumnDef<T> {
  // Each modifier returns a fresh ColumnDef so chained calls don't mutate
  // the original — important when schemas are imported in multiple places.
  const def: ColumnDef<T> = {
    [kColumn]: cfg,
    name: cfg.name,
    notNull() {
      return wrap<NonNullable<T>>({ ...cfg, notNull: true } as ColumnConfig<NonNullable<T>>)
    },
    unique() {
      return wrap<T>({ ...cfg, unique: true })
    },
    primaryKey(opts) {
      return wrap<NonNullable<T>>({
        ...cfg,
        primaryKey: true,
        notNull: true,
        autoIncrement: opts?.autoIncrement ?? false,
      } as ColumnConfig<NonNullable<T>>)
    },
    default(value: DefaultValue<T>) {
      return wrap<T>({ ...cfg, defaultValue: value })
    },
    references(ref, opts) {
      return wrap<T>({
        ...cfg,
        reference: { ref, onDelete: opts?.onDelete },
      })
    },
  }
  return def
}

export function text(name: string): ColumnDef<string | null> {
  return makeColumn<string>(name, 'TEXT')
}

export function integer(name: string): ColumnDef<number | null> {
  return makeColumn<number>(name, 'INTEGER')
}

export function real(name: string): ColumnDef<number | null> {
  return makeColumn<number>(name, 'REAL')
}

export function blob(name: string): ColumnDef<Uint8Array | null> {
  return makeColumn<Uint8Array>(name, 'BLOB')
}
