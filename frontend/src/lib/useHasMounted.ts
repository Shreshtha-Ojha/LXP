import { useSyncExternalStore } from 'react'

const noopSubscribe = () => () => {}

/**
 * True only after the client has hydrated.
 *
 * Use to gate rendering of UI that depends on client-only state (e.g. the
 * localStorage-backed auth store) — both the SSR pass and the client's
 * first render return `false` so they match (no hydration mismatch), then
 * a second client-only render returns `true`.
 */
export function useHasMounted(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false)
}
