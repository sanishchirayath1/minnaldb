# minnaldb

Lightning-fast reactive SQLite for Electron, built on `better-sqlite3`.

A thin, typed wrapper that adds:

- Drizzle-style schema definition with full TypeScript inference
- Reactive subscriptions (`query.subscribe(cb)`)
- Coalesced, transaction-aware invalidation with result diffing
- A raw-SQL escape hatch with explicit dependency declaration

## Install

```bash
npm install minnaldb
```

## Quick start

```ts
import { createDB, integer, sqliteTable, text } from 'minnaldb'

const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
})

const db = createDB({ path: 'app.db', schema: { users } })
```

## Schema definition

Define tables using column builders. Each column supports chaining:

```ts
import { sqliteTable, text, integer, real, blob } from 'minnaldb'

const posts = sqliteTable('posts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  body: text('body').notNull(),
  views: integer('views').default(() => 0),
  authorId: integer('author_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
})
```

**Column types:** `text`, `integer`, `real`, `blob`

**Modifiers:** `.notNull()`, `.unique()`, `.primaryKey()`, `.default(value)`, `.references()`

## Creating a database

```ts
const db = createDB({
  path: 'app.db',        // file path or ':memory:'
  schema: { users, posts },
  walMode: true,          // default: true
  enableForeignKeys: true, // default: true
  driver: {},             // pass-through better-sqlite3 options
})
```

## Queries

Queries are lazy and chainable. Nothing executes until you call `.run()`, `.first()`, or `.subscribe()`.

```ts
// All users
const all = db.query.users.run()

// With conditions
const admins = db.query.users
  .where(u => u.role.eq('admin'))
  .orderBy(u => u.name, 'asc')
  .limit(10)
  .offset(20)
  .run()

// First match
const user = db.query.users
  .where(u => u.email.eq('ada@acme.com'))
  .first()
```

### Where clause operators

```ts
.where(u => u.age.eq(25))        // =
.where(u => u.age.ne(25))        // !=
.where(u => u.age.gt(18))        // >
.where(u => u.age.gte(18))       // >=
.where(u => u.age.lt(65))        // <
.where(u => u.age.lte(65))       // <=
.where(u => u.name.like('%ada%')) // LIKE
.where(u => u.id.in([1, 2, 3]))  // IN
.where(u => u.email.isNull())    // IS NULL
.where(u => u.email.isNotNull()) // IS NOT NULL
```

### Combining conditions

```ts
import { and, or, not } from 'minnaldb'

.where(u => and(
  u.age.gte(18),
  or(u.role.eq('admin'), u.role.eq('editor'))
))
```

## Mutations

```ts
// Insert (single or batch)
db.insert(users).values({ name: 'Ada', email: 'ada@acme.com' })
db.insert(users).values([
  { name: 'Bob', email: 'bob@acme.com' },
  { name: 'Cy', email: 'cy@acme.com' },
])

// Update
db.update(users)
  .set({ name: 'Ada Lovelace' })
  .where(u => u.id.eq(1))

// Delete
db.delete(users)
  .where(u => u.id.eq(1))
```

All mutations return `{ changes: number }`. Insert also returns `lastInsertRowid`.

## Reactive subscriptions

Subscribe to a query to get notified when its results change. The callback fires once immediately with the current value, then again whenever a write touches a dependent table — but only if the result actually changed (deep equality check).

```ts
const unsub = db.query.users
  .where(u => u.email.like('%@acme.com'))
  .subscribe(rows => console.log(rows))

// Later:
unsub()
```

## Transactions

Wrap multiple writes in a transaction. Subscribers see a single update after commit, not one per statement.

```ts
db.transaction(() => {
  db.insert(users).values({ name: 'Bob', email: 'bob@acme.com' })
  db.insert(users).values({ name: 'Cy', email: 'cy@acme.com' })
  // Subscribers notified once here, on commit
})
```

## Raw SQL

For queries that can't be expressed with the query builder. Values are bound as parameters (never string-interpolated).

```ts
const rows = db.sql<{ count: number }>`
  SELECT COUNT(*) as count FROM users WHERE age > ${minAge}
`.deps(['users']).run()

// Subscribe to raw queries (deps required)
const unsub = db.sql<{ count: number }>`
  SELECT COUNT(*) as count FROM users
`.deps(['users']).subscribe(rows => {
  console.log('count:', rows[0]?.count)
})

// Write statements
db.sql`INSERT INTO logs (msg) VALUES (${message})`
  .deps(['logs'])
  .exec()
```

`.deps()` declares which tables the query touches — required for subscriptions and write invalidation.

## Access the underlying driver

```ts
db.raw // better-sqlite3 Database instance
```

## Cleanup

```ts
db.close()
```

## Status

v0.0.1 — proof-of-concept. Single-process, table-level invalidation, no sync.

## License

MIT
