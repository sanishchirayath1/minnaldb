# minnaldb-electron

Electron IPC bridge for [minnaldb](https://www.npmjs.com/package/minnaldb). The database lives in the main process; queries and subscriptions flow from the renderer over IPC.

## Install

```bash
npm install minnaldb-electron minnaldb electron
```

## Setup

Three files to wire up: main process, preload script, and renderer.

### 1. Main process

```ts
// main.ts
import { app, BrowserWindow, ipcMain } from 'electron'
import { createDB } from 'minnaldb'
import { exposeDB } from 'minnaldb-electron/main'
import { schema } from './shared/schema'

const db = createDB({ path: 'app.db', schema })
const handle = exposeDB(db, ipcMain)

app.on('ready', () => {
  const win = new BrowserWindow({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  })
  win.loadFile('index.html')
})

// On shutdown:
// handle.dispose()
// db.close()
```

`exposeDB` registers IPC handlers for query execution, mutations, and push-based subscriptions.

**Options:**

```ts
exposeDB(db, ipcMain, {
  channelPrefix: 'minnaldb:', // default — namespace for IPC channels
})
```

### 2. Preload script

```ts
// preload.ts
import { exposeMinnaldbBridge } from 'minnaldb-electron/preload'

exposeMinnaldbBridge()
```

This exposes a safe `window.minnaldb` bridge object. No raw `ipcRenderer` is leaked to the renderer.

### 3. Renderer

```ts
// renderer.ts
import { connectDB } from 'minnaldb-electron/renderer'
import { schema } from './shared/schema'

const db = connectDB(schema)
```

The renderer-side `db` has the same API shape as the local `minnaldb` database, but all operations are async (return Promises).

## Renderer API

### Queries

```ts
// All rows
const users = await db.query.users.run()

// With filtering, sorting, pagination
const admins = await db.query.users
  .where(u => u.role.eq('admin'))
  .orderBy(u => u.name)
  .limit(10)
  .run()

// First match
const user = await db.query.users
  .where(u => u.id.eq(1))
  .first()
```

### Subscriptions

```ts
const unsub = db.query.users
  .where(u => u.role.eq('admin'))
  .subscribe(rows => {
    console.log('admins:', rows)
  })

// Later:
unsub()
```

`.subscribe()` returns the unsubscribe function synchronously. The first callback fires asynchronously after the IPC round-trip. Subsequent callbacks are pushed from main whenever the data changes.

### Mutations

```ts
// Insert
await db.insert(users).values({ name: 'Ada', email: 'ada@acme.com' })

// Update
await db.update(users)
  .set({ name: 'Ada Lovelace' })
  .where(u => u.id.eq(1))

// Delete
await db.delete(users)
  .where(u => u.id.eq(1))
```

### Raw SQL

```ts
const rows = await db.sql<{ count: number }>`
  SELECT COUNT(*) as count FROM users
`.deps(['users']).run()

const unsub = db.sql<{ count: number }>`
  SELECT COUNT(*) as count FROM users
`.deps(['users']).subscribe(rows => {
  console.log(rows[0]?.count)
})
```

## With React

Pair with [minnaldb-react](https://www.npmjs.com/package/minnaldb-react) for reactive hooks:

```tsx
import { connectDB } from 'minnaldb-electron/renderer'
import { useQuery, useMutation } from 'minnaldb-react'
import { schema } from './shared/schema'

const db = connectDB(schema)

function NoteList() {
  const { data, loading } = useQuery(
    () => db.query.notes.orderBy(n => n.createdAt, 'desc'),
  )

  if (loading) return <p>Loading...</p>
  return <ul>{data?.map(n => <li key={n.id}>{n.title}</li>)}</ul>
}
```

## How it works

- The query builder runs entirely in the renderer — `.where()`, `.orderBy()`, etc. compile to SQL locally with zero IPC overhead
- Only the compiled `{ sql, params, depTables }` triple crosses IPC
- Writes in main trigger table-level invalidation; subscribed renderers get push updates
- Per-window subscription tracking with automatic cleanup on window destroy

## Exports

| Subpath | Use in | Purpose |
|---------|--------|---------|
| `minnaldb-electron/main` | Main process | `exposeDB()` |
| `minnaldb-electron/preload` | Preload script | `exposeMinnaldbBridge()` |
| `minnaldb-electron/renderer` | Renderer process | `connectDB()` |
| `minnaldb-electron/protocol` | Shared types | `MinnaldbBridge`, `WireQuery`, etc. |

## License

MIT
