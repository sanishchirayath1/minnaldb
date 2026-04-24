import { integer, sqliteTable, text } from 'minnaldb/wire'

export const projects = sqliteTable('projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  color: text('color').notNull(),
  createdAt: integer('created_at').notNull().default(() => Date.now()),
})

export const tasks = sqliteTable('tasks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  done: integer('done').notNull().default(0),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at').notNull().default(() => Date.now()),
})

export const schema = { projects, tasks }
export type Schema = typeof schema
