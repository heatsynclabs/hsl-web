import type { MemberSelf, MeResponse } from '@hsl/schema'

import type { ApiClient } from './client.ts'
import { ApiError } from './errors.ts'

/**
 * The signed in member, held once for the whole page. Three apps render the
 * member's name, roles and card access in a header, and every one of them would
 * otherwise ask GET /api/me again on mount. The state is module scope on
 * purpose: it is the browser tab's session, and there is only one of those.
 *
 * The state object is replaced rather than mutated, so a Vue component can hold
 * it in a shallowRef and a plain listener can compare by identity.
 */

export type SessionStatus = 'idle' | 'loading' | 'signed-in' | 'signed-out'

export interface SessionState {
  status: SessionStatus
  /** Everything GET /api/me returned, so a screen has the cards and payments too. */
  me: MeResponse | null
  /** Set when the API could not answer. A signed out member is not an error. */
  error: ApiError | null
}

export interface Session {
  readonly state: SessionState
  readonly member: MemberSelf | null
  subscribe(listener: (state: SessionState) => void): () => void
}

// better-auth answers 401 when the session cookie is missing or expired.
const NO_SESSION = 401

const IDLE: SessionState = { status: 'idle', me: null, error: null }

let state: SessionState = IDLE
let inFlight: Promise<SessionState> | null = null
const listeners = new Set<(state: SessionState) => void>()

function publish(next: SessionState): SessionState {
  state = next
  for (const listener of listeners) listener(state)
  return state
}

async function fetchMember(client: ApiClient): Promise<SessionState> {
  publish({ status: 'loading', me: state.me, error: null })

  try {
    return publish({ status: 'signed-in', me: await client.me(), error: null })
  } catch (error) {
    if (!(error instanceof ApiError)) throw error

    // Nobody signed in and the API being down both leave us with no member to show.
    const reason = error.status === NO_SESSION ? null : error
    return publish({ status: 'signed-out', me: null, error: reason })
  } finally {
    inFlight = null
  }
}

/**
 * Ask the API who is signed in. Every caller after the first gets the answer the
 * first one is already waiting for, which is what keeps this to one request no
 * matter how many components mount at once.
 */
export function loadSession(client: ApiClient): Promise<SessionState> {
  if (inFlight !== null) return inFlight
  if (state.status === 'signed-in' || state.status === 'signed-out') {
    return Promise.resolve(state)
  }

  inFlight = fetchMember(client)
  return inFlight
}

/** Ask again after a change the member made to their own row. */
export function refreshSession(client: ApiClient): Promise<SessionState> {
  if (inFlight !== null) return inFlight

  inFlight = fetchMember(client)
  return inFlight
}

/** Forget the member. Call it after sign out, and between tests. */
export function clearSession(): void {
  inFlight = null
  publish(IDLE)
}

export function useSession(): Session {
  return {
    get state() {
      return state
    },
    get member() {
      return state.me?.member ?? null
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
