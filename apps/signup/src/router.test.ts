import { clearSession, loadSession } from '@hsl/api-client'
import type { MeResponse } from '@hsl/schema'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'

import { api } from './api.ts'
import { join, resetJoin } from './join-flow.ts'
import { createJoinRouter } from './router.ts'

/** An invented member, so the guard has a signed in session to read. */
const signedIn: MeResponse = {
  member: {
    id: 'mbr_invented',
    name: 'Ash Invented',
    email: 'ash.invented@example.org',
    emailVerified: true,
    phone: null,
    postalCode: null,
    emergencyName: null,
    emergencyPhone: null,
    emergencyEmail: null,
    memberLevel: 50,
    memberLevelLabel: 'Basic ($50)',
    waiver: null,
    orientation: null,
    hidden: false,
    emailVisible: false,
    phoneVisible: false,
    currentSkills: null,
    desiredSkills: null,
    paymentMethod: null,
    payee: null,
    admin: false,
    instructor: false,
    accountant: false,
    cardAccess: false,
  },
  paymentStatus: 'paid',
  cards: [],
  certifications: [],
  payments: [],
}

function fillIn(): void {
  join.draft.name = 'Ash Invented'
  join.draft.email = 'ash.invented@example.org'
  join.draft.password = 'a long enough password'
  join.draft.waiverAccepted = true
  join.draft.memberLevel = 25
}

function newRouter() {
  return createJoinRouter(createMemoryHistory())
}

beforeEach(() => {
  vi.unstubAllGlobals()
  clearSession()
  resetJoin()
})

describe('the step order', () => {
  it('sends somebody who skipped ahead back to the step they have not filled in', async () => {
    const router = newRouter()

    await router.push('/tier')

    expect(router.currentRoute.value.name).toBe('account')
  })

  it('lets them reach the dues screen once the earlier steps are filled in', async () => {
    fillIn()
    const router = newRouter()

    await router.push('/tier')

    expect(router.currentRoute.value.name).toBe('tier')
  })

  it('keeps the last screen for an application that was actually sent', async () => {
    fillIn()
    const router = newRouter()

    await router.push('/done')
    expect(router.currentRoute.value.name).toBe('tier')

    join.created = { id: 'mbr_new', email: 'ash.invented@example.org' }
    await router.push('/done')
    expect(router.currentRoute.value.name).toBe('done')
  })

  it('will not walk back into the form after the application was sent', async () => {
    fillIn()
    join.created = { id: 'mbr_new', email: 'ash.invented@example.org' }
    const router = newRouter()

    await router.push('/tier')

    expect(router.currentRoute.value.name).toBe('done')
  })
})

describe('somebody who is already a member', () => {
  it('is told so rather than shown a second join form', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(signedIn), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    )
    await loadSession(api)
    const router = newRouter()

    await router.push('/account')

    expect(router.currentRoute.value.name).toBe('signed-in')
  })

  it('still sees the last screen after joining, because they just signed themselves in', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(signedIn), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    )
    await loadSession(api)
    join.created = { id: 'mbr_new', email: 'ash.invented@example.org' }
    const router = newRouter()

    await router.push('/done')

    expect(router.currentRoute.value.name).toBe('done')
  })
})
