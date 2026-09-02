import type { SessionState } from '@hsl/api-client'
import { useSession } from '@hsl/api-client'
import { onUnmounted, shallowRef } from 'vue'

/**
 * The signed in member as something a template can read. @hsl/api-client holds
 * one session for the whole page and replaces the state object rather than
 * mutating it, which is why a shallowRef is enough.
 */
export function useSessionState() {
  const session = useSession()
  const state = shallowRef<SessionState>(session.state)

  const stop = session.subscribe((next) => {
    state.value = next
  })
  onUnmounted(stop)

  return state
}

/** Whose privileges an admin screen asks about before it opens. */
export type Privilege = 'admin' | 'accountant'

export function holds(member: { admin: boolean; accountant: boolean }, needed: Privilege): boolean {
  if (needed === 'admin') return member.admin
  return member.accountant || member.admin
}
