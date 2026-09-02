import { renderToString } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import ResetPasswordView from './ResetPasswordView.vue'

/**
 * The link in the reset email lands here. Before this screen existed it landed
 * nowhere, and the 31 imported members who have never had a password could ask
 * for a link and then had no way to use it.
 */
const routeWith = (query: Record<string, string>) => ({
  global: {
    mocks: { $route: { query } },
    provide: {},
    stubs: {},
  },
})

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: currentQuery }),
  useRouter: () => ({ push: vi.fn() }),
}))

let currentQuery: Record<string, string> = {}

describe('the reset password screen', () => {
  it('offers a new password when the link carried a token', async () => {
    currentQuery = { token: 'a-token-from-the-email' }

    const html = await renderToString(ResetPasswordView, routeWith(currentQuery))

    expect(html).toContain('New password')
    expect(html).toContain('Set password')
  })

  it('says the link is spent when better-auth sent an error instead', async () => {
    currentQuery = { error: 'INVALID_TOKEN' }

    const html = await renderToString(ResetPasswordView, routeWith(currentQuery))

    expect(html).toContain('expired or has already been used')
    expect(html).not.toContain('Set password')
  })

  it('says the same when the link carried no token at all', async () => {
    currentQuery = {}

    const html = await renderToString(ResetPasswordView, routeWith(currentQuery))

    expect(html).toContain('expired or has already been used')
  })

  it('tells a member the password rule before they choose one', async () => {
    currentQuery = { token: 'a-token-from-the-email' }

    const html = await renderToString(ResetPasswordView, routeWith(currentQuery))

    expect(html).toContain('At least eight characters')
  })
})
