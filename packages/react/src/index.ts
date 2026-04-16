import { useEffect, useReducer, useRef, useState, useCallback } from 'react'

// We deliberately don't import from 'minnaldb' for the type-only contracts —
// we describe the minimal shapes we need so this package can be used with any
// future minnaldb version that preserves these shapes (in-process or remote).
//
// The subscribable contract is intentionally narrow: only `subscribe` is
// required. The local DB's `run()` is sync; the remote DB's is async. By
// inferring T from `subscribe`'s callback alone, the hook works with both
// without forcing a Promise<T> through the type system.
type SubscribeFn<T> = (cb: (value: T) => void) => () => void
interface Subscribable<T> {
  subscribe: SubscribeFn<T>
}

export interface UseQueryResult<T> {
  data: T | undefined
  loading: boolean
  error: Error | undefined
}

/**
 * Subscribe to a minnaldb query. The factory is invoked once per unique `deps`
 * change and on mount; the resulting subscription is torn down on unmount or
 * deps change. The synchronous initial value (from subscribe()'s first call)
 * becomes the first render's `data`.
 *
 * Pass a stable factory if you can. If your query depends on props/state,
 * pass them via `deps` so the subscription rebinds when they change.
 */
export function useQuery<T>(
  factory: () => Subscribable<T>,
  deps: ReadonlyArray<unknown> = [],
): UseQueryResult<T> {
  // We keep state in a single object to ensure data/loading/error update
  // together — avoids tearing where loading=false but data is still stale.
  const [state, setState] = useState<UseQueryResult<T>>({
    data: undefined,
    loading: true,
    error: undefined,
  })

  // Stash the latest factory in a ref so the effect can re-read it without
  // listing the function as a dep (which would defeat the point of `deps`).
  const factoryRef = useRef(factory)
  factoryRef.current = factory

  useEffect(() => {
    let cancelled = false
    try {
      const query = factoryRef.current()
      const unsub = query.subscribe((value) => {
        if (cancelled) return
        setState({ data: value, loading: false, error: undefined })
      })
      return () => {
        cancelled = true
        unsub()
      }
    } catch (err) {
      setState({ data: undefined, loading: false, error: err as Error })
      return () => {
        cancelled = true
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return state
}

export interface UseMutationResult<TArgs extends unknown[], TResult> {
  mutate: (...args: TArgs) => Promise<TResult>
  loading: boolean
  error: Error | undefined
  reset: () => void
}

/**
 * Wrap a mutation function so React components can track its in-flight state.
 * The mutator can be sync or async; we always return a Promise for uniform
 * call-site ergonomics. Errors are captured into `error` and also re-thrown
 * from the returned promise so callers can `try/catch` if they prefer.
 */
export function useMutation<TArgs extends unknown[], TResult>(
  mutator: (...args: TArgs) => TResult | Promise<TResult>,
): UseMutationResult<TArgs, TResult> {
  const [_, force] = useReducer((x: number) => x + 1, 0)
  const stateRef = useRef<{ loading: boolean; error: Error | undefined }>({
    loading: false,
    error: undefined,
  })

  const mutatorRef = useRef(mutator)
  mutatorRef.current = mutator

  const mutate = useCallback(async (...args: TArgs): Promise<TResult> => {
    stateRef.current = { loading: true, error: undefined }
    force()
    try {
      const result = await mutatorRef.current(...args)
      stateRef.current = { loading: false, error: undefined }
      force()
      return result
    } catch (err) {
      stateRef.current = { loading: false, error: err as Error }
      force()
      throw err
    }
  }, [])

  const reset = useCallback(() => {
    stateRef.current = { loading: false, error: undefined }
    force()
  }, [])

  return {
    mutate,
    loading: stateRef.current.loading,
    error: stateRef.current.error,
    reset,
  }
}
