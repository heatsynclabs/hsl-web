import type { ApiClient } from '@hsl/api-client'
import { ApiError, clearSession, loadSession } from '@hsl/api-client'
import type { MemberSelf } from '@hsl/schema'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory } from 'vue-router'

import { createAdminRouter } from './router.ts'
import { meBody } from './test-fixtures.ts'

/**
 * The guard is a courtesy and the API is the rule, so what these assert is that
 * a member never lands on a screen that would only fill with refusals. Every one
 * of these routes is checked again by services/api, per section 5 of
 * CONTRIBUTING.md.
 */

function apiAnswering(roles: Partial<MemberSelf>): ApiClient {
  return { me: async () => meBody(roles) } as unknown as ApiClient
}

const noSession: ApiClient = {
  me: async () => {
    throw ApiError.refused({
      method: 'GET',
      path: '/api/me',
      status: 401,
      body: { error: 'You are not signed in.' },
    })
  },
} as unknown as ApiClient

async function whereDoesItLand(path: string): Promise<string> {
  const router = createAdminRouter(createMemoryHistory())
  await router.push(path)
  return String(router.currentRoute.value.name)
}

beforeEach(() => {
  clearSession()
})

describe('the admin router guard', () => {
  it('opens the directory for an admin', async () => {
    await loadSession(apiAnswering({ admin: true }))

    expect(await whereDoesItLand('/directory')).toBe('directory')
  })

  it('opens the audit log for an admin', async () => {
    await loadSession(apiAnswering({ admin: true }))

    expect(await whereDoesItLand('/audit')).toBe('audit')
  })

  it('opens the door screen for an admin', async () => {
    await loadSession(apiAnswering({ admin: true }))

    expect(await whereDoesItLand('/door')).toBe('door')
  })

  it('refuses the door screen to an accountant who is not an admin', async () => {
    await loadSession(apiAnswering({ admin: false, accountant: true }))

    expect(await whereDoesItLand('/door')).toBe('no-access')
  })

  it('refuses the directory to a member who is not an admin', async () => {
    await loadSession(apiAnswering({ admin: false, accountant: false }))

    expect(await whereDoesItLand('/directory')).toBe('no-access')
  })

  it('refuses the audit log to an accountant who is not an admin', async () => {
    await loadSession(apiAnswering({ admin: false, accountant: true }))

    expect(await whereDoesItLand('/audit')).toBe('no-access')
  })

  it('opens payments for an accountant', async () => {
    await loadSession(apiAnswering({ admin: false, accountant: true }))

    expect(await whereDoesItLand('/payments')).toBe('payments')
  })

  it('opens payments for an admin, because an admin passes every check', async () => {
    await loadSession(apiAnswering({ admin: true, accountant: false }))

    expect(await whereDoesItLand('/payments')).toBe('payments')
  })

  it('refuses every screen when nobody is signed in', async () => {
    await loadSession(noSession)

    expect(await whereDoesItLand('/directory')).toBe('no-access')
    expect(await whereDoesItLand('/payments')).toBe('no-access')
    expect(await whereDoesItLand('/members/mbr_rivera')).toBe('no-access')
  })

  it('sends an address that is not a screen to the not found page', async () => {
    await loadSession(apiAnswering({ admin: true }))

    expect(await whereDoesItLand('/nothing-here')).toBe('not-found')
  })
})
