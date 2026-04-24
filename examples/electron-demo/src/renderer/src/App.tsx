import { useState } from 'react'
import { useMutation, useQuery } from 'minnaldb-react'
import { db, notes } from './db.js'

export function App() {
  // Reactive query: the callback inside useQuery receives a fresh array of
  // notes whenever the `notes` table changes — including writes made by other
  // processes (the main-process tick interval is the proof).
  const { data, loading } = useQuery(() =>
    db.query.notes.orderBy((n) => n.createdAt, 'desc'),
  )

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')

  const addNote = useMutation(async (t: string, b: string) => {
    await db.insert(notes).values({ title: t, body: b || null })
  })

  const removeNote = useMutation(async (id: number) => {
    await db.delete(notes).where((n) => n.id.eq(id))
  })

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    await addNote.mutate(title.trim(), body.trim())
    setTitle('')
    setBody('')
  }

  return (
    <main style={styles.app}>
      <header style={styles.header}>
        <h1 style={styles.title}>minnaldb · notes</h1>
        <p style={styles.subtitle}>
          Reactive SQLite over IPC. Watch this list update every 5 seconds without
          touching it — that's the main process pushing inserts.
        </p>
      </header>

      <form onSubmit={onSubmit} style={styles.form}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          style={styles.input}
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Body (optional)"
          rows={2}
          style={styles.textarea}
        />
        <button type="submit" disabled={addNote.loading} style={styles.button}>
          {addNote.loading ? 'Adding…' : 'Add note'}
        </button>
      </form>

      <section style={styles.list}>
        {loading && <div style={styles.empty}>Loading…</div>}
        {!loading && data && data.length === 0 && (
          <div style={styles.empty}>No notes yet. Add one above.</div>
        )}
        {!loading &&
          data?.map((n) => (
            <article key={n.id} style={styles.card}>
              <div style={styles.cardHead}>
                <h3 style={styles.cardTitle}>{n.title}</h3>
                <button
                  onClick={() => removeNote.mutate(n.id)}
                  disabled={removeNote.loading}
                  style={styles.deleteBtn}
                >
                  delete
                </button>
              </div>
              {n.body && <p style={styles.cardBody}>{n.body}</p>}
              <small style={styles.cardMeta}>
                <pre>{JSON.stringify(n, null, 2)}</pre>
                {new Date(n.createdAt).toLocaleString()}
              </small>
            </article>
          ))}
      </section>
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  app: {
    fontFamily: '-apple-system, system-ui, sans-serif',
    maxWidth: 720,
    margin: '0 auto',
    padding: '24px 20px 64px',
    color: '#111',
  },
  header: { marginBottom: 24 },
  title: { fontSize: 28, margin: '0 0 4px' },
  subtitle: { color: '#666', margin: 0, fontSize: 14, lineHeight: 1.5 },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: 16,
    border: '1px solid #e5e5e5',
    borderRadius: 8,
    marginBottom: 24,
    background: '#fafafa',
  },
  input: {
    padding: '8px 12px',
    fontSize: 14,
    border: '1px solid #ddd',
    borderRadius: 6,
    outline: 'none',
  },
  textarea: {
    padding: '8px 12px',
    fontSize: 14,
    border: '1px solid #ddd',
    borderRadius: 6,
    fontFamily: 'inherit',
    resize: 'vertical',
    outline: 'none',
  },
  button: {
    alignSelf: 'flex-start',
    padding: '8px 16px',
    fontSize: 14,
    background: '#111',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
  },
  list: { display: 'flex', flexDirection: 'column', gap: 12 },
  empty: { color: '#999', textAlign: 'center', padding: 24 },
  card: {
    padding: '12px 16px',
    border: '1px solid #e5e5e5',
    borderRadius: 8,
    background: '#fff',
  },
  cardHead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: { margin: 0, fontSize: 16 },
  cardBody: { margin: '6px 0 4px', color: '#333', fontSize: 14, lineHeight: 1.5 },
  cardMeta: { color: '#888', fontSize: 12 },
  deleteBtn: {
    padding: '4px 10px',
    fontSize: 12,
    background: 'transparent',
    color: '#a33',
    border: '1px solid #e5c5c5',
    borderRadius: 4,
    cursor: 'pointer',
  },
}
