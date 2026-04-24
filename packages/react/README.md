# minnaldb-react

React hooks for [minnaldb](https://www.npmjs.com/package/minnaldb) — reactive SQLite queries as hooks.

## Install

```bash
npm install minnaldb-react minnaldb react
```

## useQuery

Subscribe to a reactive query. Returns the current result, re-renders when the data changes.

```tsx
import { useQuery } from 'minnaldb-react'

function UserList() {
  const { data, loading, error } = useQuery(
    () => db.query.users.orderBy(u => u.name),
  )

  if (loading) return <p>Loading...</p>
  if (error) return <p>Error: {error.message}</p>

  return (
    <ul>
      {data?.map(user => (
        <li key={user.id}>{user.name}</li>
      ))}
    </ul>
  )
}
```

### With dependencies

Pass a dependency array to re-subscribe when values change (same semantics as `useEffect`):

```tsx
function UserDetail({ userId }: { userId: number }) {
  const { data } = useQuery(
    () => db.query.users.where(u => u.id.eq(userId)),
    [userId],
  )

  return <p>{data?.[0]?.name}</p>
}
```

### Return value

```ts
{
  data: T | undefined      // Query result (undefined while loading)
  loading: boolean          // true on initial load
  error: Error | undefined  // Populated if the query throws
}
```

### How it works

- The factory function is called once per unique `deps` change (or on mount)
- It expects the factory to return an object with a `.subscribe(callback)` method that returns an unsubscribe function
- Works with both local (`minnaldb`) and remote (`minnaldb-electron/renderer`) database instances
- The subscription is torn down on unmount or when deps change

## useMutation

Wraps a mutation function with loading/error state tracking.

```tsx
import { useMutation } from 'minnaldb-react'

function AddUserForm() {
  const { mutate, loading, error } = useMutation(
    (name: string, email: string) =>
      db.insert(users).values({ name, email }),
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await mutate('Ada', 'ada@acme.com')
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <p>Error: {error.message}</p>}
      <button disabled={loading}>
        {loading ? 'Saving...' : 'Add User'}
      </button>
    </form>
  )
}
```

### Return value

```ts
{
  mutate: (...args) => Promise<TResult>  // Call to execute the mutation
  loading: boolean                        // true while in-flight
  error: Error | undefined                // Populated on failure
  reset: () => void                       // Clear loading and error state
}
```

## With Electron (remote database)

Works identically with `minnaldb-electron/renderer` — the hooks don't care whether the database is local or remote:

```tsx
import { connectDB } from 'minnaldb-electron/renderer'
import { useQuery, useMutation } from 'minnaldb-react'
import { schema } from './shared/schema'

const db = connectDB(schema)

function NoteList() {
  const { data } = useQuery(
    () => db.query.notes.orderBy(n => n.createdAt, 'desc'),
  )
  return <ul>{data?.map(n => <li key={n.id}>{n.title}</li>)}</ul>
}
```

## License

MIT
