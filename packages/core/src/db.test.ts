import { describe, expect, it, vi } from 'vitest'
import { createDB, integer, sqliteTable, text } from './index.js'

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

const schema = { users, posts }

function freshDB() {
  return createDB({ path: ':memory:', schema })
}

describe('createDB', () => {
  it('creates tables from the schema', () => {
    const db = freshDB()
    const tables = db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
    expect(tables.map((t) => t.name)).toContain('users')
    expect(tables.map((t) => t.name)).toContain('posts')
    db.close()
  })

  it('inserts and selects with typed builder', () => {
    const db = freshDB()
    db.insert(users).values({ name: 'Ada', email: 'ada@x.com' })
    db.insert(users).values({ name: 'Bob', email: 'bob@x.com' })
    const all = db.query.users.orderBy((u) => u.name).run()
    expect(all).toHaveLength(2)
    expect(all[0]?.name).toBe('Ada')
    expect(all[1]?.name).toBe('Bob')
    db.close()
  })

  it('filters with where', () => {
    const db = freshDB()
    db.insert(users).values([
      { name: 'Ada', email: 'ada@acme.com' },
      { name: 'Bob', email: 'bob@other.com' },
    ])
    const acme = db.query.users.where((u) => u.email.like('%@acme.com')).run()
    expect(acme).toHaveLength(1)
    expect(acme[0]?.name).toBe('Ada')
    db.close()
  })

  it('updates with where', () => {
    const db = freshDB()
    const { lastInsertRowid } = db.insert(users).values({ name: 'Ada', email: 'ada@x.com' })
    db.update(users).set({ name: 'Ada L.' }).where((u) => u.id.eq(Number(lastInsertRowid)))
    const row = db.query.users.first()
    expect(row?.name).toBe('Ada L.')
    db.close()
  })

  it('deletes with where', () => {
    const db = freshDB()
    const { lastInsertRowid } = db.insert(users).values({ name: 'Ada', email: 'ada@x.com' })
    db.delete(users).where((u) => u.id.eq(Number(lastInsertRowid)))
    expect(db.query.users.run()).toHaveLength(0)
    db.close()
  })

  it('reactive subscription fires when relevant table changes', async () => {
    const db = freshDB()
    const cb = vi.fn()
    const unsub = db.query.users.subscribe(cb)
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb.mock.calls[0]?.[0]).toEqual([])
    cb.mockClear()
    db.insert(users).values({ name: 'Ada', email: 'ada@x.com' })
    await Promise.resolve()
    db.subscriptions.flushSync()
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb.mock.calls[0]?.[0]).toHaveLength(1)
    unsub()
    db.close()
  })

  it('does not fire when an unrelated table changes', async () => {
    const db = freshDB()
    db.insert(users).values({ name: 'Ada', email: 'ada@x.com' })
    const cb = vi.fn()
    db.query.posts.subscribe(cb)
    cb.mockClear()
    db.insert(users).values({ name: 'Bob', email: 'bob@x.com' })
    await new Promise((r) => setTimeout(r, 5))
    expect(cb).not.toHaveBeenCalled()
    db.close()
  })

  it('transactions batch invalidation', async () => {
    const db = freshDB()
    const cb = vi.fn()
    db.query.users.subscribe(cb)
    cb.mockClear()
    db.transaction(() => {
      db.insert(users).values({ name: 'Ada', email: 'ada@x.com' })
      db.insert(users).values({ name: 'Bob', email: 'bob@x.com' })
      db.insert(users).values({ name: 'Cy', email: 'cy@x.com' })
    })
    await Promise.resolve()
    db.subscriptions.flushSync()
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb.mock.calls[0]?.[0]).toHaveLength(3)
    db.close()
  })

  it('rollback discards changes and does not fire subscribers', async () => {
    const db = freshDB()
    const cb = vi.fn()
    db.query.users.subscribe(cb)
    cb.mockClear()
    expect(() =>
      db.transaction(() => {
        db.insert(users).values({ name: 'Ada', email: 'ada@x.com' })
        throw new Error('boom')
      }),
    ).toThrow('boom')
    await new Promise((r) => setTimeout(r, 5))
    expect(cb).not.toHaveBeenCalled()
    expect(db.query.users.run()).toHaveLength(0)
    db.close()
  })

  it('raw sql with deps subscribes', async () => {
    const db = freshDB()
    db.insert(users).values({ name: 'Ada', email: 'ada@x.com' })
    const cb = vi.fn()
    const handle = db.sql<{ n: number }>`SELECT COUNT(*) as n FROM users`.deps(['users'])
    handle.subscribe(cb)
    cb.mockClear()
    db.insert(users).values({ name: 'Bob', email: 'bob@x.com' })
    await Promise.resolve()
    db.subscriptions.flushSync()
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb.mock.calls[0]?.[0]).toEqual([{ n: 2 }])
    db.close()
  })

  it('raw sql subscribe without deps throws', () => {
    const db = freshDB()
    expect(() => db.sql`SELECT 1`.subscribe(() => {})).toThrow(/declare table deps/)
    db.close()
  })

  it('foreign key cascades wired up', () => {
    const db = freshDB()
    const u = db.insert(users).values({ name: 'Ada', email: 'ada@x.com' })
    db.insert(posts).values({ userId: Number(u.lastInsertRowid), title: 'Hi' })
    db.delete(users).where((x) => x.id.eq(Number(u.lastInsertRowid)))
    expect(db.query.posts.run()).toHaveLength(0)
    db.close()
  })

  it('result diffing prevents redundant fires', async () => {
    const db = freshDB()
    db.insert(users).values({ name: 'Ada', email: 'ada@x.com' })
    const cb = vi.fn()
    db.query.users.subscribe(cb)
    cb.mockClear()
    // Update name to itself — same row count, same content.
    db.update(users).set({ name: 'Ada' }).where((u) => u.email.eq('ada@x.com'))
    await Promise.resolve()
    db.subscriptions.flushSync()
    expect(cb).not.toHaveBeenCalled()
    db.close()
  })
})
