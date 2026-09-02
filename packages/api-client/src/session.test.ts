import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createClient } from './client.ts'
import { ApiError } from './errors.ts'
import { clearSession, loadSession, refreshSession, useSession } from './session.ts'
import { meBody } from './test-fixtures.ts'

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const client = createClient({ baseUrl: '' })

beforeEach(() => {
  vi.unstubAllGlobals()
  clearSession()
})

describe('the session at bootstrap', () => {
  it('asks who is signed in once, however many components ask', async () => {
    const fetched = vi.fn(async () => answer(200, meBody))
    vi.stubGlobal('fetch', fetched)

    await Promise.all([loadSession(client), loadSession(client), loadSession(client)])
    await loadSession(client)

    expect(fetched).toHaveBeenCalledTimes(1)
    expect(useSession().member?.name).toBe('Ada Testwell')
  })

  it('tells subscribers when the member arrives', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer(200, meBody)))
    const seen: string[] = []
    const unsubscribe = useSession().subscribe((state) => seen.push(state.status))

    await loadSession(client)
    unsubscribe()
    await refreshSession(client)

    expect(seen).toEqual(['loading', 'signed-in'])
  })

  it('reads nobody signed in as an ordinary answer, not a failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer(401, { error: 'no session' })))

    const state = await loadSession(client)

    expect(state.status).toBe('signed-out')
    expect(state.error).toBeNull()
    expect(useSession().member).toBeNull()
  })

  it('keeps the reason when the API cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('failed to fetch'))))

    const state = await loadSession(client)

    expect(state.status).toBe('signed-out')
    expect(state.error).toBeInstanceOf(ApiError)
    expect(state.error?.status).toBe(0)
  })
})

describe('after the member changes their own row', () => {
  it('asks again when refreshed, and not before', async () => {
    const fetched = vi.fn(async () => answer(200, meBody))
    vi.stubGlobal('fetch', fetched)

    await loadSession(client)
    await loadSession(client)
    await refreshSession(client)

    expect(fetched).toHaveBeenCalledTimes(2)
  })

  it('forgets the member on sign out', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer(200, meBody)))
    await loadSession(client)

    clearSession()

    expect(useSession().state.status).toBe('idle')
    expect(useSession().member).toBeNull()
  })
})
