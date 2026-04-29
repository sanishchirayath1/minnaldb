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

## Signals

`minnaldb-react/signals` exposes signal-based alternatives to `useQuery` and `useMutation`. Instead of calling `setState` on every update (which re-renders the entire component), these hooks write into [Preact Signals](https://github.com/preactjs/signals). Components that read a specific signal only re-render when that signal changes.

### Install

```bash
npm install @preact/signals-core
# Optional — enables automatic signal tracking in React components:
npm install @preact/signals-react
```

`@preact/signals-core` is an optional peer dependency of `minnaldb-react`. If you don't use the signals entry point, you don't need it.

### useQuerySignal

```tsx
import '@preact/signals-react'  // auto-tracking (optional)
import { useQuerySignal } from 'minnaldb-react/signals'

function UserCount() {
  const { data, loading } = useQuerySignal(
    () => db.query.users,
  )

  if (loading.value) return <p>Loading...</p>
  return <p>{data.value?.length ?? 0} users</p>
}
```

#### Return value

```ts
{
  data: ReadonlySignal<T | undefined>       // Reactive query result
  loading: ReadonlySignal<boolean>           // true until first value arrives
  error: ReadonlySignal<Error | undefined>   // Populated if the query throws
}
```

Like `useQuery`, it accepts an optional `deps` array to re-subscribe when values change:

```tsx
const { data } = useQuerySignal(
  () => db.query.tasks.where(t => t.projectId.eq(pid)),
  [pid],
)
```

### useMutationSignal

```tsx
import { useMutationSignal } from 'minnaldb-react/signals'

function AddUserButton() {
  const { mutate, loading, error } = useMutationSignal(
    (name: string, email: string) =>
      db.insert(users).values({ name, email }),
  )

  return (
    <>
      {error.value && <p>Error: {error.value.message}</p>}
      <button
        disabled={loading.value}
        onClick={() => mutate('Ada', 'ada@acme.com')}
      >
        {loading.value ? 'Saving...' : 'Add User'}
      </button>
    </>
  )
}
```

#### Return value

```ts
{
  mutate: (...args) => Promise<TResult>          // Call to execute the mutation
  loading: ReadonlySignal<boolean>               // true while in-flight
  error: ReadonlySignal<Error | undefined>       // Populated on failure
  reset: () => void                              // Clear loading and error state
}
```

### Why signals?

With the standard `useQuery` hook, every subscription update calls `setState`, which re-renders the component and all its children — even if they only read `loading` or a derived value like `data.length`.

With signals:
- A component reading `loading.value` won't re-render when `data` changes
- A component reading `data.value` won't re-render when `error` changes
- A parent that calls `useQuerySignal` but doesn't read any `.value` won't re-render at all — only the children that actually consume the signal do

This makes signals a good fit for dashboards, stat counters, or any UI where many components derive different views from the same underlying query.

### Using without @preact/signals-react

If you prefer not to add `@preact/signals-react`, you can bridge signals into React with `useSyncExternalStore`:

```tsx
import { useSyncExternalStore } from 'react'
import { effect, type ReadonlySignal } from '@preact/signals-core'

function useSignalValue<T>(sig: ReadonlySignal<T>): T {
  return useSyncExternalStore(
    (cb) => effect(() => { sig.value; cb() }),
    () => sig.value,
  )
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
