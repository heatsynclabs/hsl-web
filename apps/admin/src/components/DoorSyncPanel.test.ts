import { ApiError } from '@hsl/api-client'
import { renderToString } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import DoorSyncPanel from './DoorSyncPanel.vue'

const base = { saving: false, queuedAt: null, error: null }

describe('DoorSyncPanel', () => {
  it('says the push happens on a timer, so nobody treats the button as a chore', async () => {
    const html = await renderToString(DoorSyncPanel, { props: base })

    expect(html).toContain('about once a minute')
    expect(html).toContain('nothing to remember after assigning or deactivating a card')
    expect(html).toContain('only shortens the wait')
  })

  it('confirms when the request was taken', async () => {
    const html = await renderToString(DoorSyncPanel, {
      props: { ...base, queuedAt: '2026-09-01T17:44:00.000Z' },
    })

    expect(html).toContain('Asked at')
    expect(html).toContain('next pass')
  })

  it('prints the refusal when the API would not take the request', async () => {
    const down = ApiError.refused({
      method: 'POST',
      path: '/api/door/sync',
      status: 503,
      body: { error: 'The door service has not reported recently.' },
    })

    const html = await renderToString(DoorSyncPanel, { props: { ...base, error: down } })

    expect(html).toContain('The door service has not reported recently.')
  })
})
