import type { DoorStatusResponse } from '@hsl/schema'
import { renderToString } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { doorReportingLive } from '../test-fixtures.ts'
import DoorControlPanel from './DoorControlPanel.vue'

const base = { busy: null, failure: '' }

describe('DoorControlPanel', () => {
  it('shows each door in the state the controller reported', async () => {
    const unlockedFront: DoorStatusResponse = {
      ...doorReportingLive,
      status: { ...doorReportingLive.status!, frontLocked: false },
    }

    const html = await renderToString(DoorControlPanel, { props: { ...base, door: unlockedFront } })

    expect(html).toContain('Front door')
    expect(html).toContain('Unlocked')
    expect(html).toContain('Rear door')
    expect(html).toContain('Locked')
  })

  it('offers the alarm as one toggle carrying the state it would leave', async () => {
    const html = await renderToString(DoorControlPanel, { props: { ...base, door: doorReportingLive } })

    expect(html).toContain('Disarm alarm')
    expect(html).not.toContain('Arm alarm')
  })

  it('renders unlock rear disabled, with the lab decision beside it', async () => {
    const html = await renderToString(DoorControlPanel, { props: { ...base, door: doorReportingLive } })

    expect(html).toContain('Unlock rear')
    expect(html).toMatch(/<button[^>]*\sdisabled[\s>][^]*?Unlock rear/)
    expect(html).toContain('refused by the lab decision of 2018-02-22')
  })

  it('says unknown and turns the controls off when the report is too old', async () => {
    const stale: DoorStatusResponse = { ...doorReportingLive, stale: true }
    const html = await renderToString(DoorControlPanel, { props: { ...base, door: stale } })

    expect(html).toContain('Unknown')
    expect(html).toContain('too old to read as live')
    expect(html).toContain('The controls are off until the door service reports again')
    expect(html).toMatch(/<button[^>]*\sdisabled[\s>][^]*?Open front/)
  })

  it('says the controller has never reported rather than drawing a door state', async () => {
    const never: DoorStatusResponse = { status: null, reportedAt: null, stale: true }
    const html = await renderToString(DoorControlPanel, { props: { ...base, door: never } })

    expect(html).toContain('has never reported')
    expect(html).toContain('Physical cards still open the door')
    expect(html).toContain('Unknown')
  })

  it('says which command was refused and what the API said about it', async () => {
    const html = await renderToString(DoorControlPanel, {
      props: {
        ...base,
        door: doorReportingLive,
        failure: 'Open front was refused. The door service has not reported recently.',
      },
    })

    expect(html).toContain('Open front was refused.')
  })
})
