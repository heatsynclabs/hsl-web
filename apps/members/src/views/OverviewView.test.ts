import { ApiError, clearSession } from '@hsl/api-client'
import type { MeResponse } from '@hsl/schema'
import { renderToString } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import { apiKey } from '../lib/api'
import { SAM, SAM_ME, stubApi } from '../test-fixtures'
import OverviewView from './OverviewView.vue'

function render(me: () => Promise<MeResponse>): Promise<string> {
  return renderToString(OverviewView, {
    global: { provide: { [apiKey]: stubApi({ me }) } },
  })
}

function refused(status: number, error: string): ApiError {
  return ApiError.refused({ method: 'GET', path: '/api/me', status, body: { error } })
}

afterEach(() => {
  clearSession()
})

describe('the overview screen', () => {
  it('prints the member the API returned', async () => {
    const html = await render(() => Promise.resolve(SAM_ME))

    expect(html).toContain('Sam Rivera')
    expect(html).toContain('sam@example.org')
    expect(html).toContain('480 555 0142')
    expect(html).toContain('85201')
  })

  it('labels the level from the bands in @hsl/schema rather than the number', async () => {
    const html = await render(() => Promise.resolve(SAM_ME))

    expect(html).toContain('Basic ($50)')
    expect(html).toContain('Paid')
  })

  it('says which contact details other members can read', async () => {
    const html = await render(() => Promise.resolve(SAM_ME))

    expect(html).toContain('Visible to members')
    expect(html).toContain('Hidden')
  })

  it('prints the card at the slot it was given, never renumbered', async () => {
    const html = await render(() => Promise.resolve(SAM_ME))

    expect(html).toContain('041')
    expect(html).toContain('0000A1B2')
  })

  it('says plainly when a member holds no card and no certifications', async () => {
    const empty: MeResponse = { ...SAM_ME, cards: [], certifications: [], payments: [] }
    const html = await render(() => Promise.resolve(empty))

    expect(html).toContain('No card on your record yet. Ask an admin to assign one.')
    expect(html).toContain('No certifications recorded yet.')
    expect(html).toContain('None recorded')
  })

  it('shows what to do next when the request fails, not a blank screen', async () => {
    const html = await render(() =>
      Promise.reject(refused(503, 'The database is down.')),
    )

    expect(html).toContain('The lab link or the database is down')
    expect(html).toContain('Try again')
    expect(html).not.toContain('Sam Rivera')
  })

  it('offers the way back in when the session has gone', async () => {
    const html = await render(() => Promise.reject(refused(401, 'You are not signed in.')))

    expect(html).toContain('Sign in and try again.')
    expect(html).toContain('href="/sign-in"')
  })

  it('does not promise the two admin rule the lab decided against', async () => {
    const html = await render(() => Promise.resolve(SAM_ME))

    expect(html).toContain('written to the audit log')
    expect(html).not.toContain('two admins')
  })

  it('never offers a member the fields an admin owns', async () => {
    const html = await render(() => Promise.resolve({ ...SAM_ME, member: SAM }))

    expect(html).not.toContain('Edit member level')
    expect(html).not.toContain('Edit orientation')
  })
})
