import { describe, expect, it, vi } from 'vitest'
import { SubscriptionManager, deepEqual } from './subscriptions.js'

describe('SubscriptionManager', () => {
  it('fires the callback synchronously on subscribe with the initial value', () => {
    const subs = new SubscriptionManager()
    const cb = vi.fn()
    subs.subscribe(['users'], () => 42, cb)
    expect(cb).toHaveBeenCalledWith(42)
  })

  it('re-evaluates when a relevant table is notified', async () => {
    const subs = new SubscriptionManager()
    let value = 1
    const cb = vi.fn()
    subs.subscribe(['users'], () => value, cb)
    cb.mockClear()
    value = 2
    subs.notify(['users'])
    await Promise.resolve()
    subs.flushSync()
    expect(cb).toHaveBeenCalledWith(2)
  })

  it('does not fire when an unrelated table is notified', async () => {
    const subs = new SubscriptionManager()
    const cb = vi.fn()
    subs.subscribe(['users'], () => 1, cb)
    cb.mockClear()
    subs.notify(['posts'])
    await new Promise((r) => setTimeout(r, 5))
    expect(cb).not.toHaveBeenCalled()
  })

  it('coalesces multiple notifications into a single re-eval per microtask', async () => {
    const subs = new SubscriptionManager()
    const evaluate = vi.fn(() => Math.random())
    const cb = vi.fn()
    subs.subscribe(['users'], evaluate, cb)
    evaluate.mockClear()
    cb.mockClear()
    subs.notify(['users'])
    subs.notify(['users'])
    subs.notify(['users'])
    await Promise.resolve()
    subs.flushSync()
    expect(evaluate).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('skips the callback when the new value deep-equals the previous one', async () => {
    const subs = new SubscriptionManager()
    const cb = vi.fn()
    subs.subscribe(['users'], () => [{ id: 1, name: 'a' }], cb)
    cb.mockClear()
    subs.notify(['users'])
    await Promise.resolve()
    subs.flushSync()
    expect(cb).not.toHaveBeenCalled()
  })

  it('buffers notifications during a transaction and releases on commit', async () => {
    const subs = new SubscriptionManager()
    let value = 1
    const cb = vi.fn()
    subs.subscribe(['users'], () => value, cb)
    cb.mockClear()
    subs.beginTransaction()
    value = 2
    subs.notify(['users'])
    value = 3
    subs.notify(['users'])
    expect(cb).not.toHaveBeenCalled()
    subs.commitTransaction()
    await Promise.resolve()
    subs.flushSync()
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenCalledWith(3)
  })

  it('discards buffered notifications on rollback', async () => {
    const subs = new SubscriptionManager()
    const cb = vi.fn()
    subs.subscribe(['users'], () => 1, cb)
    cb.mockClear()
    subs.beginTransaction()
    subs.notify(['users'])
    subs.rollbackTransaction()
    await new Promise((r) => setTimeout(r, 5))
    expect(cb).not.toHaveBeenCalled()
  })

  it('unsubscribe stops further callbacks', async () => {
    const subs = new SubscriptionManager()
    let value = 1
    const cb = vi.fn()
    const unsub = subs.subscribe(['users'], () => value, cb)
    cb.mockClear()
    unsub()
    value = 2
    subs.notify(['users'])
    await Promise.resolve()
    subs.flushSync()
    expect(cb).not.toHaveBeenCalled()
  })
})

describe('deepEqual', () => {
  it('handles primitives, arrays, objects, dates, and Uint8Array', () => {
    expect(deepEqual(1, 1)).toBe(true)
    expect(deepEqual('a', 'a')).toBe(true)
    expect(deepEqual([1, 2], [1, 2])).toBe(true)
    expect(deepEqual([1, 2], [1, 3])).toBe(false)
    expect(deepEqual({ a: 1 }, { a: 1 })).toBe(true)
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false)
    expect(deepEqual(new Date(1000), new Date(1000))).toBe(true)
    expect(deepEqual(new Date(1000), new Date(2000))).toBe(false)
    expect(deepEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true)
    expect(deepEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false)
    expect(deepEqual(null, null)).toBe(true)
    expect(deepEqual(null, undefined)).toBe(false)
  })
})
