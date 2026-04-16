import { createDB, integer, sqliteTable, text } from 'minnaldb'

// 1. Define schema — Drizzle-style. Types flow from these definitions.
const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
})

const posts = sqliteTable('posts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
})

const db = createDB({ path: ':memory:', schema: { users, posts } })

// 2. Subscribe to a query. The callback fires once with the initial value, then
//    again whenever the `users` table is mutated (with result diffing).
const unsub = db.query.users
  .orderBy((u) => u.name)
  .subscribe((rows) => {
    console.log(`[users] ${rows.length} row(s):`, rows.map((r) => r.name).join(', ') || '(empty)')
  })

// 3. Mutate. Subscribers will be notified after the current microtask.
db.insert(users).values({ name: 'Ada', email: 'ada@x.com' })
db.insert(users).values({ name: 'Bob', email: 'bob@x.com' })

// 4. Transaction — three writes, ONE subscriber notification.
db.transaction(() => {
  db.insert(users).values({ name: 'Cy', email: 'cy@x.com' })
  db.insert(users).values({ name: 'Dee', email: 'dee@x.com' })
  db.insert(users).values({ name: 'Eve', email: 'eve@x.com' })
})

// 5. Raw SQL escape hatch — note the explicit .deps() declaration.
const topNames = db.sql<{ name: string }>`SELECT name FROM users ORDER BY name LIMIT 3`.deps([
  'users',
])
topNames.subscribe((rows) => {
  console.log('[top 3]', rows.map((r) => r.name).join(', '))
})

// 6. A no-op update — name set to its current value. Result diffing prevents
//    this from re-firing the subscriber. Watch the console: no extra log.
setTimeout(() => {
  db.update(users).set({ name: 'Ada' }).where((u) => u.email.eq('ada@x.com'))
}, 50)

// 7. Cleanup after a tick so all microtasks drain.
setTimeout(() => {
  unsub()
  db.close()
  console.log('done')
}, 200)
