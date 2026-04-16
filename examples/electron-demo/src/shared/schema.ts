// Schema imported by both the main process (where the DB lives) and the
// renderer (which uses the same definitions to drive the typed query builder
// and to receive properly-typed rows over IPC).
//
// Keeping this file in `shared/` makes the cross-process import explicit and
// keeps the renderer free of any node-only code.

// Import from `minnaldb/wire` (not `minnaldb`) so this module is safe to
// import in the renderer process — `minnaldb` transitively loads better-sqlite3,
// which the renderer can't use.
import { integer, sqliteTable, text } from 'minnaldb/wire'

export const notes = sqliteTable('notes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  body: text('body'),
  createdAt: integer('created_at').notNull().default(() => Date.now()),
})

export const schema = { notes }
export type Schema = typeof schema
