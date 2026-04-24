import { useState } from 'react'
import { useMutation, useQuery } from 'minnaldb-react'
import { db, projects, tasks } from './db.js'

export function App() {
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null)
  const [filter, setFilter] = useState<'all' | 'active' | 'done'>('all')
  const [newTask, setNewTask] = useState('')
  const [newProject, setNewProject] = useState('')
  const [newColor, setNewColor] = useState('#6366f1')
  const [showProjectForm, setShowProjectForm] = useState(false)

  const { data: allProjects } = useQuery(
    () => db.query.projects.orderBy((p) => p.name),
  )

  const { data: allTasks, loading: tasksLoading } = useQuery(
    () => {
      let q = db.query.tasks.orderBy((t) => t.createdAt, 'desc')
      if (selectedProjectId !== null) {
        q = q.where((t) => t.projectId.eq(selectedProjectId))
      }
      if (filter === 'active') q = q.where((t) => t.done.eq(0))
      if (filter === 'done') q = q.where((t) => t.done.eq(1))
      return q
    },
    [selectedProjectId, filter],
  )

  const addTask = useMutation(async (title: string) => {
    await db.insert(tasks).values({
      title,
      projectId: selectedProjectId,
    })
  })

  const toggleTask = useMutation(async (id: number, currentDone: number) => {
    await db.update(tasks).set({ done: currentDone ? 0 : 1 }).where((t) => t.id.eq(id))
  })

  const removeTask = useMutation(async (id: number) => {
    await db.delete(tasks).where((t) => t.id.eq(id))
  })

  const addProject = useMutation(async (name: string, color: string) => {
    await db.insert(projects).values({ name, color })
  })

  const removeProject = useMutation(async (id: number) => {
    await db.delete(projects).where((p) => p.id.eq(id))
  })

  const onAddTask = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTask.trim()) return
    await addTask.mutate(newTask.trim())
    setNewTask('')
  }

  const onAddProject = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newProject.trim()) return
    await addProject.mutate(newProject.trim(), newColor)
    setNewProject('')
    setShowProjectForm(false)
  }

  const projectMap = new Map(
    (allProjects ?? []).map((p) => [p.id, p]),
  )

  const totalTasks = allTasks?.length ?? 0
  const doneTasks = allTasks?.filter((t) => t.done).length ?? 0

  return (
    <div style={styles.layout}>
      {/* Sidebar */}
      <aside style={styles.sidebar}>
        <h1 style={styles.logo}>minnaldb</h1>
        <p style={styles.logoSub}>task manager</p>

        <nav style={styles.nav}>
          <button
            style={{
              ...styles.navItem,
              ...(selectedProjectId === null ? styles.navItemActive : {}),
            }}
            onClick={() => setSelectedProjectId(null)}
          >
            <span style={styles.navDot('#888')} />
            All Tasks
          </button>

          {allProjects?.map((p) => (
            <div key={p.id} style={styles.navRow}>
              <button
                style={{
                  ...styles.navItem,
                  ...(selectedProjectId === p.id ? styles.navItemActive : {}),
                  flex: 1,
                }}
                onClick={() => setSelectedProjectId(p.id)}
              >
                <span style={styles.navDot(p.color)} />
                {p.name}
              </button>
              <button
                style={styles.navDelete}
                onClick={(e) => {
                  e.stopPropagation()
                  removeProject.mutate(p.id)
                  if (selectedProjectId === p.id) setSelectedProjectId(null)
                }}
                title="Delete project and its tasks"
              >
                x
              </button>
            </div>
          ))}
        </nav>

        {showProjectForm ? (
          <form onSubmit={onAddProject} style={styles.projectForm}>
            <input
              value={newProject}
              onChange={(e) => setNewProject(e.target.value)}
              placeholder="Project name"
              style={styles.projectInput}
              autoFocus
            />
            <div style={styles.colorRow}>
              {['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#06b6d4'].map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setNewColor(c)}
                  style={{
                    ...styles.colorSwatch,
                    background: c,
                    outline: newColor === c ? `2px solid ${c}` : 'none',
                    outlineOffset: 2,
                  }}
                />
              ))}
            </div>
            <div style={styles.projectFormActions}>
              <button type="submit" style={styles.projectSubmit}>Add</button>
              <button
                type="button"
                style={styles.projectCancel}
                onClick={() => setShowProjectForm(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            style={styles.addProjectBtn}
            onClick={() => setShowProjectForm(true)}
          >
            + New Project
          </button>
        )}
      </aside>

      {/* Main content */}
      <main style={styles.main}>
        <header style={styles.header}>
          <div>
            <h2 style={styles.heading}>
              {selectedProjectId === null
                ? 'All Tasks'
                : projectMap.get(selectedProjectId)?.name ?? 'Tasks'}
            </h2>
            <p style={styles.stats}>
              {doneTasks}/{totalTasks} completed
            </p>
          </div>

          <div style={styles.filters}>
            {(['all', 'active', 'done'] as const).map((f) => (
              <button
                key={f}
                style={{
                  ...styles.filterBtn,
                  ...(filter === f ? styles.filterBtnActive : {}),
                }}
                onClick={() => setFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
        </header>

        {/* Progress bar */}
        {totalTasks > 0 && (
          <div style={styles.progressTrack}>
            <div
              style={{
                ...styles.progressBar,
                width: `${(doneTasks / totalTasks) * 100}%`,
              }}
            />
          </div>
        )}

        {/* Add task form */}
        <form onSubmit={onAddTask} style={styles.addForm}>
          <input
            value={newTask}
            onChange={(e) => setNewTask(e.target.value)}
            placeholder={
              selectedProjectId !== null
                ? `Add task to ${projectMap.get(selectedProjectId)?.name ?? 'project'}...`
                : 'Add a task...'
            }
            style={styles.addInput}
          />
          <button type="submit" disabled={addTask.loading} style={styles.addBtn}>
            Add
          </button>
        </form>

        {/* Task list */}
        <div style={styles.taskList}>
          {tasksLoading && <p style={styles.empty}>Loading...</p>}
          {!tasksLoading && totalTasks === 0 && (
            <p style={styles.empty}>
              No tasks yet. Add one above.
            </p>
          )}
          {allTasks?.map((t) => {
            const project = t.projectId ? projectMap.get(t.projectId) : null
            return (
              <div key={t.id} style={styles.task}>
                <button
                  style={{
                    ...styles.checkbox,
                    ...(t.done ? styles.checkboxDone : {}),
                  }}
                  onClick={() => toggleTask.mutate(t.id, t.done)}
                >
                  {t.done ? '\u2713' : ''}
                </button>
                <div style={styles.taskContent}>
                  <span
                    style={{
                      ...styles.taskTitle,
                      ...(t.done ? styles.taskTitleDone : {}),
                    }}
                  >
                    {t.title}
                  </span>
                  <div style={styles.taskMeta}>
                    {project && (
                      <span style={styles.taskTag(project.color)}>
                        {project.name}
                      </span>
                    )}
                    <span style={styles.taskDate}>
                      {new Date(t.createdAt).toLocaleString()}
                    </span>
                  </div>
                </div>
                <button
                  style={styles.deleteBtn}
                  onClick={() => removeTask.mutate(t.id)}
                >
                  delete
                </button>
              </div>
            )
          })}
        </div>
      </main>
    </div>
  )
}

const styles = {
  layout: {
    display: 'flex',
    height: '100vh',
    fontFamily: '-apple-system, system-ui, "Segoe UI", sans-serif',
    color: '#1a1a2e',
    background: '#f8f9fb',
  } satisfies React.CSSProperties,

  // Sidebar
  sidebar: {
    width: 240,
    background: '#1a1a2e',
    color: '#ccc',
    padding: '24px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    flexShrink: 0,
  } satisfies React.CSSProperties,
  logo: {
    margin: 0,
    fontSize: 20,
    fontWeight: 700,
    color: '#fff',
    letterSpacing: -0.5,
  } satisfies React.CSSProperties,
  logoSub: {
    margin: '2px 0 20px',
    fontSize: 12,
    color: '#666',
    textTransform: 'uppercase' as const,
    letterSpacing: 1.5,
  } satisfies React.CSSProperties,
  nav: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    flex: 1,
  } satisfies React.CSSProperties,
  navRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
  } satisfies React.CSSProperties,
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 12px',
    background: 'transparent',
    color: '#aaa',
    border: 'none',
    borderRadius: 6,
    fontSize: 14,
    cursor: 'pointer',
    textAlign: 'left' as const,
    width: '100%',
  } satisfies React.CSSProperties,
  navItemActive: {
    background: 'rgba(255,255,255,0.1)',
    color: '#fff',
  } satisfies React.CSSProperties,
  navDot: (color: string): React.CSSProperties => ({
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: color,
    display: 'inline-block',
    flexShrink: 0,
  }),
  navDelete: {
    background: 'transparent',
    border: 'none',
    color: '#555',
    cursor: 'pointer',
    fontSize: 12,
    padding: '4px 6px',
    borderRadius: 4,
    lineHeight: 1,
  } satisfies React.CSSProperties,
  addProjectBtn: {
    marginTop: 8,
    padding: '8px 12px',
    background: 'rgba(255,255,255,0.06)',
    color: '#888',
    border: '1px dashed rgba(255,255,255,0.15)',
    borderRadius: 6,
    fontSize: 13,
    cursor: 'pointer',
  } satisfies React.CSSProperties,
  projectForm: {
    marginTop: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  } satisfies React.CSSProperties,
  projectInput: {
    padding: '6px 10px',
    fontSize: 13,
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 6,
    background: 'rgba(255,255,255,0.06)',
    color: '#fff',
    outline: 'none',
  } satisfies React.CSSProperties,
  colorRow: {
    display: 'flex',
    gap: 6,
  } satisfies React.CSSProperties,
  colorSwatch: {
    width: 20,
    height: 20,
    borderRadius: '50%',
    border: 'none',
    cursor: 'pointer',
  } satisfies React.CSSProperties,
  projectFormActions: {
    display: 'flex',
    gap: 6,
  } satisfies React.CSSProperties,
  projectSubmit: {
    padding: '5px 12px',
    fontSize: 12,
    background: '#6366f1',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
  } satisfies React.CSSProperties,
  projectCancel: {
    padding: '5px 12px',
    fontSize: 12,
    background: 'transparent',
    color: '#888',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 4,
    cursor: 'pointer',
  } satisfies React.CSSProperties,

  // Main
  main: {
    flex: 1,
    padding: '28px 36px',
    overflowY: 'auto',
  } satisfies React.CSSProperties,
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  } satisfies React.CSSProperties,
  heading: {
    margin: 0,
    fontSize: 24,
    fontWeight: 600,
  } satisfies React.CSSProperties,
  stats: {
    margin: '4px 0 0',
    fontSize: 13,
    color: '#888',
  } satisfies React.CSSProperties,
  filters: {
    display: 'flex',
    gap: 4,
  } satisfies React.CSSProperties,
  filterBtn: {
    padding: '5px 12px',
    fontSize: 12,
    background: '#eee',
    color: '#555',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    textTransform: 'capitalize' as const,
  } satisfies React.CSSProperties,
  filterBtnActive: {
    background: '#1a1a2e',
    color: '#fff',
  } satisfies React.CSSProperties,
  progressTrack: {
    height: 4,
    background: '#e5e7eb',
    borderRadius: 2,
    marginBottom: 20,
    overflow: 'hidden',
  } satisfies React.CSSProperties,
  progressBar: {
    height: '100%',
    background: '#10b981',
    borderRadius: 2,
    transition: 'width 0.3s ease',
  } satisfies React.CSSProperties,

  // Add form
  addForm: {
    display: 'flex',
    gap: 8,
    marginBottom: 20,
  } satisfies React.CSSProperties,
  addInput: {
    flex: 1,
    padding: '10px 14px',
    fontSize: 14,
    border: '1px solid #e0e0e0',
    borderRadius: 8,
    outline: 'none',
    background: '#fff',
  } satisfies React.CSSProperties,
  addBtn: {
    padding: '10px 20px',
    fontSize: 14,
    fontWeight: 500,
    background: '#1a1a2e',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
  } satisfies React.CSSProperties,

  // Task list
  taskList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  } satisfies React.CSSProperties,
  empty: {
    textAlign: 'center',
    color: '#999',
    padding: 40,
    fontSize: 14,
  } satisfies React.CSSProperties,
  task: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 14px',
    background: '#fff',
    border: '1px solid #eee',
    borderRadius: 8,
  } satisfies React.CSSProperties,
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    border: '2px solid #ccc',
    background: '#fff',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
    color: '#fff',
    flexShrink: 0,
    padding: 0,
    lineHeight: 1,
  } satisfies React.CSSProperties,
  checkboxDone: {
    background: '#10b981',
    borderColor: '#10b981',
  } satisfies React.CSSProperties,
  taskContent: {
    flex: 1,
    minWidth: 0,
  } satisfies React.CSSProperties,
  taskTitle: {
    fontSize: 14,
    display: 'block',
  } satisfies React.CSSProperties,
  taskTitleDone: {
    textDecoration: 'line-through',
    color: '#999',
  } satisfies React.CSSProperties,
  taskMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 3,
  } satisfies React.CSSProperties,
  taskTag: (color: string): React.CSSProperties => ({
    fontSize: 11,
    padding: '1px 8px',
    borderRadius: 10,
    background: color + '18',
    color: color,
    fontWeight: 500,
  }),
  taskDate: {
    fontSize: 11,
    color: '#aaa',
  } satisfies React.CSSProperties,
  deleteBtn: {
    padding: '4px 10px',
    fontSize: 12,
    background: 'transparent',
    color: '#c44',
    border: '1px solid #f0d0d0',
    borderRadius: 4,
    cursor: 'pointer',
    flexShrink: 0,
  } satisfies React.CSSProperties,
}
