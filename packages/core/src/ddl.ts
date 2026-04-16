import { kColumn, type ColumnDef, type Table, tableMeta } from './schema/index.js'

// Quote an identifier (table or column name) so reserved words / weird chars
// are safe. SQLite uses double-quotes for identifiers.
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

// Render a JS literal as a SQL DEFAULT expression. We deliberately do NOT
// support arbitrary JS values here — function defaults are applied at insert
// time in the mutation layer, not embedded into DDL.
function renderDefault(value: unknown): string | null {
  if (value === undefined) return null
  if (value === null) return 'NULL'
  if (typeof value === 'object' && value !== null && 'sql' in (value as Record<string, unknown>)) {
    return String((value as { sql: string }).sql)
  }
  if (typeof value === 'function') {
    // Function defaults are applied at insert time, not in DDL.
    return null
  }
  if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  if (typeof value === 'boolean') return value ? '1' : '0'
  return null
}

export function generateCreateTable(
  table: Table<any, any>,
  columnToTable: Map<ColumnDef<any>, string>,
): string {
  const tCfg = tableMeta(table)
  const colDefs: string[] = []
  const tableConstraints: string[] = []

  for (const [_, col] of Object.entries(tCfg.columns)) {
    const c = col[kColumn]
    const parts = [quoteIdent(c.name), c.affinity]

    if (c.primaryKey) {
      parts.push('PRIMARY KEY')
      if (c.autoIncrement) parts.push('AUTOINCREMENT')
    }
    if (c.notNull && !c.primaryKey) parts.push('NOT NULL')
    if (c.unique && !c.primaryKey) parts.push('UNIQUE')

    const def = renderDefault(c.defaultValue)
    if (def !== null) parts.push(`DEFAULT ${def}`)

    colDefs.push(parts.join(' '))

    if (c.reference) {
      const targetCol = c.reference.ref()
      const targetTableName = columnToTable.get(targetCol)
      if (!targetTableName) {
        throw new Error(
          `minnaldb: foreign key on ${tCfg.name}.${c.name} references a column that is not part of the schema. ` +
            `Make sure the referenced table is included in the schema passed to createDB().`,
        )
      }
      const targetColName = targetCol[kColumn].name
      const onDelete = c.reference.onDelete
        ? ` ON DELETE ${c.reference.onDelete.toUpperCase()}`
        : ''
      tableConstraints.push(
        `FOREIGN KEY (${quoteIdent(c.name)}) REFERENCES ${quoteIdent(targetTableName)}(${quoteIdent(targetColName)})${onDelete}`,
      )
    }
  }

  const body = [...colDefs, ...tableConstraints].join(',\n  ')
  return `CREATE TABLE IF NOT EXISTS ${quoteIdent(tCfg.name)} (\n  ${body}\n);`
}

export function generateSchemaDDL(
  schema: Record<string, Table<any, any>>,
  columnToTable: Map<ColumnDef<any>, string>,
): string {
  return Object.values(schema)
    .map(t => generateCreateTable(t, columnToTable))
    .join('\n\n')
}
