import type { ApiClient } from '@hsl/api-client'
import { ApiError, clearSession, loadSession } from '@hsl/api-client'
import { renderToString } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'

import { meBody } from '../test-fixtures.ts'
import NoAccessView from './NoAccessView.vue'

const signedOut: ApiClient = {
  me: async () => {
    throw ApiError.refused({
      method: 'GET',
      path: '/api/me',
      status: 401,
      body: { error: 'You are not signed in.' },
    })
  },
} as unknown as ApiClient

beforeEach(() => {
  clearSession()
})

describe('the screen a refused navigation lands on', () => {
  it('tells a signed out browser where to sign in', async () => {
    await loadSession(signedOut)

    const html = await renderToString(NoAccessView)

    expect(html).toContain('Sign in first')
    expect(html).toContain('Nobody is signed in on this browser.')
  })

  it('tells a member without the privilege what to ask for', async () => {
    await loadSession({
      me: async () => meBody({ admin: false, accountant: false }),
    } as unknown as ApiClient)

    const html = await renderToString(NoAccessView)

    expect(html).toContain('Not your screen')
    expect(html).toContain('Ask an admin whether your account should hold that.')
  })
})
