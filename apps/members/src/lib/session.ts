import type { SessionState } from '@hsl/api-client'
import { useSession } from '@hsl/api-client'
import type { ShallowRef } from 'vue'
import { onUnmounted, shallowRef } from 'vue'

/**
 * The signed in member as a Vue ref. @hsl/api-client holds the state for the
 * whole tab and replaces the object rather than mutating it, so a shallowRef is
 * enough and no component asks GET /api/me again on mount.
 */
export function useMemberSession(): ShallowRef<SessionState> {
  const session = useSession()
  const state = shallowRef(session.state)

  const stop = session.subscribe((next) => {
    state.value = next
  })
  onUnmounted(stop)

  return state
}
