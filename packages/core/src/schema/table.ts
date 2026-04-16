import { kColumn, kTable, type ColumnDef, type ColumnsRecord, type Table, type TableConfig } from './types.js'

// Extract the {name, columns} metadata from a table without going through the
// intersection type, which TS often can't index in generic contexts.
export function tableMeta<T extends Table<any, any>>(t: T): TableConfig<string, ColumnsRecord> {
  return (t as unknown as { [kTable]: TableConfig<string, ColumnsRecord> })[kTable]
}

export function sqliteTable<TName extends string, TCols extends ColumnsRecord>(
  name: TName,
  columns: TCols,
): Table<TName, TCols> {
  // Stamp each column's runtime config with its DB column name in case the
  // user-facing key differs from the SQL name (e.g. { userId: integer('user_id') }).
  // The factory functions already set name from the argument, so we just verify.
  for (const [key, col] of Object.entries(columns)) {
    if (!col[kColumn].name) {
      // Fall back to the property key if no name was supplied.
      ;(col[kColumn] as { name: string }).name = key
    }
  }

  // Spread the columns onto the table so users can write `users.id`. The
  // metadata fields use symbol/underscore keys so they can't collide with
  // user-chosen column names.
  const table = {
    ...columns,
    [kTable]: { name, columns },
    _: { name, columns },
  } as Table<TName, TCols>
  return table
}

// Walk a schema record and resolve foreign-key lambdas to concrete table+column
// pairs. Called once per createDB() so cyclic references are fine.
export function resolveSchema(
  schema: Record<string, Table<any, any>>,
): { columnToTable: Map<ColumnDef<any>, string> } {
  const columnToTable = new Map<ColumnDef<any>, string>()
  for (const t of Object.values(schema)) {
    const meta = tableMeta(t)
    for (const col of Object.values(meta.columns)) {
      columnToTable.set(col, meta.name)
    }
  }
  return { columnToTable }
}
