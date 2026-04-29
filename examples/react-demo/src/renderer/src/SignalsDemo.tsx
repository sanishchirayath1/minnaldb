/**
 * Signals demo — a live stats dashboard powered by `useQuerySignal` and
 * `useMutationSignal` from `minnaldb-react/signals`.
 *
 * Each stat card is its own component reading a specific signal, so only the
 * card whose data changed re-renders — not the whole dashboard.
 *
 * `@preact/signals-react` auto-tracks signal reads in components — reading
 * `.value` in render automatically subscribes the component to that signal.
 */
import '@preact/signals-react'
import { useState, useRef } from 'react'
import { useQuerySignal, useMutationSignal } from 'minnaldb-react/signals'
import { db, tasks } from './db.js'

// ---------------------------------------------------------------------------
// Render counter — proves that only the card whose signal changed re-renders.
// ---------------------------------------------------------------------------
function useRenderCount() {
  const count = useRef(0)
  count.current++
  return count.current
}

// ---------------------------------------------------------------------------
// Individual stat cards — each reads only the signal(s) it needs.
// ---------------------------------------------------------------------------

function TotalTasksCard() {
  const { data } = useQuerySignal(() => db.query.tasks)
  const renders = useRenderCount()

  return (
    <div style={styles.card}>
      <span style={styles.cardValue}>{data.value?.length ?? 0}</span>
      <span style={styles.cardLabel}>Total Tasks</span>
      <span style={styles.renderBadge}>renders: {renders}</span>
    </div>
  )
}

function CompletedCard() {
  const { data } = useQuerySignal(
    () => db.query.tasks.where((t) => t.done.eq(1)),
  )
  const renders = useRenderCount()

  return (
    <div style={styles.card}>
      <span style={styles.cardValue}>{data.value?.length ?? 0}</span>
      <span style={styles.cardLabel}>Completed</span>
      <span style={styles.renderBadge}>renders: {renders}</span>
    </div>
  )
}

function ActiveCard() {
  const { data } = useQuerySignal(
    () => db.query.tasks.where((t) => t.done.eq(0)),
  )
  const renders = useRenderCount()

  return (
    <div style={styles.card}>
      <span style={styles.cardValue}>{data.value?.length ?? 0}</span>
      <span style={styles.cardLabel}>Active</span>
      <span style={styles.renderBadge}>renders: {renders}</span>
    </div>
  )
}

function ProjectCountCard() {
  const { data } = useQuerySignal(() => db.query.projects)
  const renders = useRenderCount()

  return (
    <div style={styles.card}>
      <span style={styles.cardValue}>{data.value?.length ?? 0}</span>
      <span style={styles.cardLabel}>Projects</span>
      <span style={styles.renderBadge}>renders: {renders}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Quick-add using useMutationSignal — loading/error are signals too.
// ---------------------------------------------------------------------------

function QuickAdd() {
  const [title, setTitle] = useState('')
  const { mutate, loading, error } = useMutationSignal(
    async (t: string) => {
      await db.insert(tasks).values({ title: t })
    },
  )
  const renders = useRenderCount()

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    await mutate(title.trim())
    setTitle('')
  }

  return (
    <form onSubmit={onSubmit} style={styles.quickAdd}>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Quick add task (signals)..."
        style={styles.quickInput}
      />
      <button type="submit" disabled={loading.value} style={styles.quickBtn}>
        {loading.value ? '...' : 'Add'}
      </button>
      {error.value && <span style={styles.error}>{error.value.message}</span>}
      <span style={styles.renderBadge}>renders: {renders}</span>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Dashboard container — this component never re-renders when data changes
// because it doesn't read any signal values itself.
// ---------------------------------------------------------------------------

export function SignalsDemo() {
  const renders = useRenderCount()

  return (
    <section style={styles.section}>
      <div style={styles.headerRow}>
        <div>
          <h3 style={styles.title}>Signals Dashboard</h3>
          <p style={styles.subtitle}>
            Each card subscribes to its own signal — only re-renders when its data changes.
          </p>
        </div>
        <span style={{ ...styles.renderBadge, ...styles.parentBadge }}>
          parent renders: {renders}
        </span>
      </div>

      <div style={styles.grid}>
        <TotalTasksCard />
        <CompletedCard />
        <ActiveCard />
        <ProjectCountCard />
      </div>

      <QuickAdd />
    </section>
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = {
  section: {
    marginTop: 32,
    padding: 20,
    background: '#fafbff',
    border: '1px solid #e2e4f0',
    borderRadius: 10,
  } satisfies React.CSSProperties,

  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  } satisfies React.CSSProperties,

  title: {
    margin: 0,
    fontSize: 16,
    fontWeight: 600,
    color: '#1a1a2e',
  } satisfies React.CSSProperties,

  subtitle: {
    margin: '4px 0 0',
    fontSize: 12,
    color: '#888',
  } satisfies React.CSSProperties,

  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 12,
  } satisfies React.CSSProperties,

  card: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '16px 12px',
    background: '#fff',
    border: '1px solid #eee',
    borderRadius: 8,
    position: 'relative',
  } satisfies React.CSSProperties,

  cardValue: {
    fontSize: 28,
    fontWeight: 700,
    color: '#1a1a2e',
    lineHeight: 1,
  } satisfies React.CSSProperties,

  cardLabel: {
    fontSize: 12,
    color: '#888',
    marginTop: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  } satisfies React.CSSProperties as React.CSSProperties,

  renderBadge: {
    fontSize: 10,
    color: '#6366f1',
    background: '#eef0ff',
    padding: '2px 6px',
    borderRadius: 4,
    marginTop: 8,
    fontFamily: 'monospace',
  } satisfies React.CSSProperties,

  parentBadge: {
    marginTop: 0,
    alignSelf: 'flex-start',
  } satisfies React.CSSProperties,

  quickAdd: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
  } satisfies React.CSSProperties,

  quickInput: {
    flex: 1,
    padding: '8px 12px',
    fontSize: 13,
    border: '1px solid #dde',
    borderRadius: 6,
    outline: 'none',
    background: '#fff',
  } satisfies React.CSSProperties,

  quickBtn: {
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 500,
    background: '#6366f1',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
  } satisfies React.CSSProperties,

  error: {
    fontSize: 12,
    color: '#ef4444',
  } satisfies React.CSSProperties,
}
