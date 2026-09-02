import { renderToString } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'

import { api } from '../api.ts'
import { join, resetJoin, submitJoin } from '../join-flow.ts'
import { createJoinRouter } from '../router.ts'
import TierView from './TierView.vue'

function render(): Promise<string> {
  return renderToString(TierView, {
    global: { plugins: [createJoinRouter(createMemoryHistory())] },
  })
}

function fillIn(): void {
  join.draft.name = 'Ash Invented'
  join.draft.email = 'ash.invented@example.org'
  join.draft.password = 'a long enough password'
  join.draft.waiverAccepted = true
  join.draft.memberLevel = 50
}

beforeEach(() => {
  vi.unstubAllGlobals()
  resetJoin()
})

describe('the dues step', () => {
  it('shows the three dues tiers and volunteer, priced', async () => {
    const html = await render()

    expect(html).toContain('$25 a month')
    expect(html).toContain('$50 a month')
    expect(html).toContain('$100 a month')
    expect(html).toContain('Volunteer')
    expect(html).toContain('No dues')
  })

  it('promises no payment, because this app never takes one', async () => {
    const html = await render()

    expect(html).toContain('Nothing in this app takes a card number')
  })
})

describe('when the application is refused', () => {
  it('offers sign in for an email that already has an account', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'already exists' }), {
            status: 409,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    )
    fillIn()

    await submitJoin(api)
    const html = await render()

    expect(html).toContain('There is already an account for that email address')
    expect(html).toContain('Go to sign in')
    expect(html).toContain('href="/"')
  })

  it('shows a sentence a person can act on when the API is down, not a blank screen', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('failed to fetch'))),
    )
    fillIn()

    await submitJoin(api)
    const html = await render()

    expect(html).toContain('got no response at all')
    expect(html).toContain('Check that the API is up')
    expect(html).not.toContain('Go to sign in')
  })
})
