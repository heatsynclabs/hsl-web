import { renderToString } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { doorEventEntries } from '../test-fixtures.ts'
import DoorEventList from './DoorEventList.vue'

describe('DoorEventList', () => {
  it('shows a card read as the number and the outcome, not as a record', async () => {
    const html = await renderToString(DoorEventList, { props: { events: doorEventEntries } })

    expect(html).toContain('Card 0004B1C7 was held to a reader. Refused.')
    expect(html).not.toContain('"cardNumber"')
  })

  it('reads a push an admin asked for as a sentence', async () => {
    const html = await renderToString(DoorEventList, { props: { events: doorEventEntries } })

    expect(html).toContain('The card table was pushed because an admin asked for it.')
  })

  it('falls back to the kind and its detail for a kind it has never seen', async () => {
    const html = await renderToString(DoorEventList, { props: { events: doorEventEntries } })

    expect(html).toContain('weather-station-read: celsius 31')
  })

  it('says nothing has been reported rather than drawing an empty list', async () => {
    const html = await renderToString(DoorEventList, { props: { events: [] } })

    expect(html).toContain('The door service has not reported anything yet.')
  })
})
