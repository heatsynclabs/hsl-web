import { ApiError, clearSession, loadSession } from '@hsl/api-client'
import type { DoorStatusResponse, MeResponse } from '@hsl/schema'
import { renderToString } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import { apiKey } from '../lib/api'
import { SAM, SAM_ME, stubApi } from '../test-fixtures'
import DoorView from './DoorView.vue'

const LOCKED_FRONT_OPEN: DoorStatusResponse = {
  status: { frontLocked: false, rearLocked: true, armed: 255, activated: 255, alarm2: 1, alarm3: 1 },
  reportedAt: '2026-09-01T18:42:00.000Z',
  stale: false,
}

async function signIn(me: MeResponse): Promise<void> {
  clearSession()
  await loadSession(stubApi({ me: () => Promise.resolve(me) }))
}

function render(doorStatus: () => Promise<DoorStatusResponse>): Promise<string> {
  return renderToString(DoorView, {
    global: { provide: { [apiKey]: stubApi({ doorStatus }) } },
  })
}

afterEach(() => {
  clearSession()
})

describe('the door screen', () => {
  it('shows each door in the state the controller reported', async () => {
    await signIn(SAM_ME)
    const html = await render(() => Promise.resolve(LOCKED_FRONT_OPEN))

    expect(html).toContain('Front door')
    expect(html).toContain('Unlocked')
    expect(html).toContain('Rear door')
    expect(html).toContain('Locked')
  })

  it('offers the alarm as one toggle carrying the state it would leave', async () => {
    await signIn(SAM_ME)
    const html = await render(() => Promise.resolve(LOCKED_FRONT_OPEN))

    expect(html).toContain('Disarm alarm')
    expect(html).not.toContain('Arm alarm')
  })

  it('renders unlock rear disabled, with the lab decision beside it', async () => {
    await signIn(SAM_ME)
    const html = await render(() => Promise.resolve(LOCKED_FRONT_OPEN))

    expect(html).toContain('Unlock rear')
    expect(html).toMatch(/<button[^>]*\sdisabled[\s>][^]*?Unlock rear/)
    expect(html).toContain('refused by the lab decision of 2018-02-22')
  })

  it('gives a member without card access the tiles and a way to get the controls', async () => {
    await signIn({ ...SAM_ME, member: { ...SAM, cardAccess: false } })
    const html = await render(() => Promise.resolve(LOCKED_FRONT_OPEN))

    expect(html).toContain('Front door')
    expect(html).toContain('How to get the controls')
    expect(html).toContain('needs card access on your member record')
    expect(html).not.toContain('Open front')
  })

  it('says unknown rather than guessing when the report is too old', async () => {
    await signIn(SAM_ME)
    const stale: DoorStatusResponse = { ...LOCKED_FRONT_OPEN, stale: true }
    const html = await render(() => Promise.resolve(stale))

    expect(html).toContain('Unknown')
    expect(html).toContain('too old to read as live')
    expect(html).not.toContain('Unlocked')
  })

  it('says the controller has never reported rather than drawing a door state', async () => {
    await signIn(SAM_ME)
    const never: DoorStatusResponse = { status: null, reportedAt: null, stale: true }
    const html = await render(() => Promise.resolve(never))

    expect(html).toContain('has never reported')
    expect(html).toContain('Physical cards still open the door')
    expect(html).toContain('Unknown')
  })

  it('shows what to do next when the status request fails', async () => {
    await signIn(SAM_ME)
    const html = await render(() =>
      Promise.reject(
        ApiError.refused({
          method: 'GET',
          path: '/api/door/status',
          status: 503,
          body: { error: 'The door service has not reported recently.' },
        }),
      ),
    )

    expect(html).toContain('Physical cards still work')
    expect(html).toContain('Front door')
  })

  it('starts the recent list empty rather than inventing past actions', async () => {
    await signIn(SAM_ME)
    const html = await render(() => Promise.resolve(LOCKED_FRONT_OPEN))

    expect(html).toContain('Nothing yet on this visit.')
  })
})
