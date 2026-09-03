import { ApiError } from '@hsl/api-client'
import { mount, renderToString } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { attached, click } from '../test-support/interact.ts'
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

/**
 * Asking the door service to push the card table now rather than on its next
 * pass. Harmless to press twice, but a button that sends nothing looks like a
 * broken door and sends a volunteer looking in the wrong place.
 */
describe('DoorSyncPanel, clicked', () => {
  it('asks for a sync when pressed', async () => {
    const wrapper = mount(DoorSyncPanel, { ...attached, props: base })

    await click(wrapper, 'Sync now')

    expect(wrapper.emitted('sync')).toEqual([[]])
  })

  it('asks for nothing while the last ask is still in flight', async () => {
    const wrapper = mount(DoorSyncPanel, { ...attached, props: { ...base, saving: true } })

    await click(wrapper, 'Asking')

    expect(wrapper.emitted('sync')).toBeUndefined()
  })
})
