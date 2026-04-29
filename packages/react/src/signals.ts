import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { effect, signal, type ReadonlySignal, type Signal } from '@preact/signals-core'

// Same minimal subscribable contract as the main entry point — keeps this
// module decoupled from the concrete minnaldb package.
type SubscribeFn<T> = (cb: (value: T) => void) => () => void
interface Subscribable<T> {
  subscribe: SubscribeFn<T>
}

// Re-export ReadonlySignal so consumers don't need to depend on
// @preact/signals-core directly.
export type { ReadonlySignal } from '@preact/signals-core'

/**
 * Read a signal's value inside a React component. The component re-renders
 * only when this specific signal changes — not when sibling signals update.
 *
 * Uses React's built-in `useSyncExternalStore` under the hood.
 *
 * ```tsx
 * const { data } = useQuerySignal(() => db.query.users)
 * const users = useSignalValue(data)
 * return <p>{users?.length ?? 0} users</p>
 * ```
 */
export function useSignalValue<T>(sig: ReadonlySignal<T>): T {
  return useSyncExternalStore(
    (cb) => effect(() => { sig.value; cb() }),
    () => sig.value,
  )
}

export interface UseQuerySignalResult<T> {
  /** Reactive signal containing the latest query result. */
  data: ReadonlySignal<T | undefined>
  /** Reactive signal — true while the first value hasn't arrived yet. */
  loading: ReadonlySignal<boolean>
  /** Reactive signal containing the last error, if any. */
  error: ReadonlySignal<Error | undefined>
}

/**
 * Signal-based alternative to `useQuery`. Instead of triggering a React
 * re-render on every subscription update, this hook writes into signals.
 *
 * Use `useSignalValue` to read signals in your components — only the
 * component reading a specific signal re-renders when it changes.
 *
 * ```tsx
 * import { useQuerySignal, useSignalValue } from 'minnaldb-react/signals'
 * function UserCount() {
 *   const { data } = useQuerySignal(() => db.query.users)
 *   const users = useSignalValue(data)
 *   return <span>{users?.length ?? 0}</span>
 * }
 * ```
 */
export function useQuerySignal<T>(
  factory: () => Subscribable<T>,
  deps: ReadonlyArray<unknown> = [],
): UseQuerySignalResult<T> {
  const signalsRef = useRef<{
    data: Signal<T | undefined>
    loading: Signal<boolean>
    error: Signal<Error | undefined>
  } | null>(null)

  if (signalsRef.current === null) {
    signalsRef.current = {
      data: signal(undefined),
      loading: signal(true),
      error: signal(undefined),
    }
  }

  const { data, loading, error } = signalsRef.current

  const factoryRef = useRef(factory)
  factoryRef.current = factory

  useEffect(() => {
    let cancelled = false
    loading.value = true
    error.value = undefined

    try {
      const query = factoryRef.current()
      const unsub = query.subscribe((value) => {
        if (cancelled) return
        data.value = value
        loading.value = false
        error.value = undefined
      })
      return () => {
        cancelled = true
        unsub()
      }
    } catch (err) {
      data.value = undefined
      loading.value = false
      error.value = err as Error
      return () => {
        cancelled = true
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, loading, error }
}

export interface UseMutationSignalResult<TArgs extends unknown[], TResult> {
  /** Call to execute the mutation. Always returns a Promise. */
  mutate: (...args: TArgs) => Promise<TResult>
  /** Reactive signal — true while the mutation is in flight. */
  loading: ReadonlySignal<boolean>
  /** Reactive signal containing the last error, if any. */
  error: ReadonlySignal<Error | undefined>
  /** Reset loading and error signals to their idle state. */
  reset: () => void
}

/**
 * Signal-based alternative to `useMutation`. Loading and error state are
 * exposed as signals, so only the parts of the UI that read them will
 * re-render.
 */
export function useMutationSignal<TArgs extends unknown[], TResult>(
  mutator: (...args: TArgs) => TResult | Promise<TResult>,
): UseMutationSignalResult<TArgs, TResult> {
  const signalsRef = useRef<{
    loading: Signal<boolean>
    error: Signal<Error | undefined>
  } | null>(null)

  if (signalsRef.current === null) {
    signalsRef.current = {
      loading: signal(false),
      error: signal(undefined),
    }
  }

  const { loading, error } = signalsRef.current

  const mutatorRef = useRef(mutator)
  mutatorRef.current = mutator

  const mutate = useCallback(async (...args: TArgs): Promise<TResult> => {
    loading.value = true
    error.value = undefined
    try {
      const result = await mutatorRef.current(...args)
      loading.value = false
      return result
    } catch (err) {
      loading.value = false
      error.value = err as Error
      throw err
    }
  }, [])

  const reset = useCallback(() => {
    loading.value = false
    error.value = undefined
  }, [])

  return { mutate, loading, error, reset }
}
