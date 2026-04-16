# minnaldb

**മിന്നൽ — lightning.** A reactive SQLite layer for Electron, built on `better-sqlite3`.

A thin, typed wrapper that adds:

- Drizzle-style schema definition with full TypeScript inference
- Reactive subscriptions (`query.subscribe(cb)` / React `useQuery`)
- Coalesced, transaction-aware invalidation with result diffing
- A raw-SQL escape hatch with explicit dependency declaration

Designed for Electron desktop apps that want SQLite power with RxDB-grade ergonomics, no separate database process, no IndexedDB.

## Status

v0.0.1 — proof-of-concept. Single-process, table-level invalidation, no sync.

## Workspace

```
packages/
  core/      → minnaldb            (createDB, schema, queries, mutations, sql, subscriptions)
  react/     → minnaldb-react      (useQuery, useMutation)
  electron/  → minnaldb-electron   (exposeDB / connectDB IPC bridge for Electron)
examples/
  node-demo/                       (end-to-end Node.js usage)
  electron-demo/                   (Electron + React notes app)
```

## Quick example

```ts
import { createDB, integer, sqliteTable, text } from 'minnaldb'

const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
})

const db = createDB({ path: 'app.db', schema: { users } })

// One-shot
const all = db.query.users.orderBy(u => u.name).run()

// Reactive — fires once initially, then on any write to `users`,
// only if the result actually changed.
const unsub = db.query.users
  .where(u => u.email.like('%@acme.com'))
  .subscribe(rows => console.log(rows))

// Mutations notify subscribers automatically.
db.insert(users).values({ name: 'Ada', email: 'ada@acme.com' })

// Transactions batch invalidation: subscribers see ONE update on commit.
db.transaction(() => {
  db.insert(users).values({ name: 'Bob', email: 'bob@acme.com' })
  db.insert(users).values({ name: 'Cy', email: 'cy@acme.com' })
})

// Raw SQL escape hatch — explicit deps required for subscription.
db.sql<{ n: number }>`SELECT COUNT(*) as n FROM users`
  .deps(['users'])
  .subscribe(rows => console.log('count', rows[0]?.n))
```

## Scripts

```bash
pnpm install
pnpm --filter minnaldb test               # run core tests (22 cases)
pnpm -r typecheck                          # typecheck the whole workspace
pnpm -r build                              # build all packages
pnpm --filter minnaldb-node-demo start     # node example
pnpm --filter minnaldb-electron-demo dev   # electron + react notes app
```

### Native-module ABI note

`better-sqlite3` is hoisted by pnpm and compiled against a single Node ABI
at a time. After running the Electron demo, the binary will be Electron-ABI
and the Node-side tests will fail. Toggle with:

```bash
pnpm rebuild:node      # before running tests / node-demo
pnpm rebuild:electron  # before running the electron-demo
```

A v0.0.3 improvement is to ship prebuilt binaries for both ABIs and
load the right one at runtime.

## Electron usage (sketch)

```ts
// main.ts
import { app, BrowserWindow, ipcMain } from 'electron'
import { createDB } from 'minnaldb'
import { exposeDB } from 'minnaldb-electron/main'
import { schema } from './shared/schema'

const db = createDB({ path: 'app.db', schema })
exposeDB(db, ipcMain)
// ... createWindow with preload pointing at the bridge

// preload.cjs
import { exposeMinnaldbBridge } from 'minnaldb-electron/preload'
exposeMinnaldbBridge()

// renderer (React)
import { connectDB } from 'minnaldb-electron/renderer'
import { useQuery } from 'minnaldb-react'
import { schema } from './shared/schema'

const db = connectDB(schema)
function NoteList() {
  const { data } = useQuery(() => db.query.notes.orderBy(n => n.createdAt, 'desc'))
  return <ul>{data?.map(n => <li key={n.id}>{n.title}</li>)}</ul>
}
```

The renderer-side query builder is identical to the in-process one — it
compiles SQL locally and only the `{sql, params, depTables}` triple crosses
IPC. Subscriptions are push-based: writes (in any process) trigger
invalidation in main, which forwards updates to subscribed windows.

## What's NOT in v0.0.2 (intentionally)

- Sync / replication
- Row-level invalidation (queries that touch a table re-run on any write to it)
- Tauri support (Node-native module)
- Migrations beyond `CREATE TABLE IF NOT EXISTS`
- Transactions across IPC (works in-process; v0.0.3 will batch a remote tx
  into a single IPC round-trip)
- Vue/Svelte adapters
- Encryption
