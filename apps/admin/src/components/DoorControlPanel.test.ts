import type { DoorStatusResponse } from '@hsl/schema'
import { mount, renderToString } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { attached, buttonLabels, click, isDisabled } from '../test-support/interact.ts'
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

/**
 * The controls that open a building. Rendering proves the rear unlock button is
 * on the screen and disabled. Only clicking proves that pressing it sends
 * nothing, which is the part the 2018 lab decision is about.
 */
describe('DoorControlPanel, clicked', () => {
  function panel(door: DoorStatusResponse = doorReportingLive) {
    return mount(DoorControlPanel, { ...attached, props: { ...base, door } })
  }

  /**
   * Every button, not just the first. Asserting one of them leaves a mis-paired
   * command in the v-for invisible, and the wrong pairing buzzes a door open
   * when somebody asked to lock the building.
   */
  it.each([
    ['Open front', 'open-front'],
    ['Unlock front', 'unlock-front'],
    ['Lock all', 'lock'],
    ['Disarm alarm', 'disarm'],
  ])('sends %s as %s, and nothing else', async (label, command) => {
    const wrapper = panel()

    await click(wrapper, label)

    expect(wrapper.emitted('send')).toEqual([[command, label]])
  })

  it('sends arm when the alarm is off, so the toggle is not stuck one way', async () => {
    const off: DoorStatusResponse = {
      ...doorReportingLive,
      status: { ...doorReportingLive.status!, armed: 0 },
    }
    const wrapper = panel(off)

    await click(wrapper, 'Arm alarm')

    expect(wrapper.emitted('send')).toEqual([['arm', 'Arm alarm']])
  })

  it('sends nothing when the rear unlock button is pressed, per the 2018 decision', async () => {
    const wrapper = panel()

    expect(isDisabled(wrapper, 'Unlock rear')).toBe(true)
    await click(wrapper, 'Unlock rear')

    expect(wrapper.emitted('send')).toBeUndefined()
  })

  it('sends nothing while the last report is too old to read as live', async () => {
    const wrapper = panel({ ...doorReportingLive, stale: true })

    await click(wrapper, 'Open front')
    await click(wrapper, 'Lock all')

    expect(wrapper.emitted('send')).toBeUndefined()
  })

  it('sends nothing while another command is already in flight', async () => {
    const wrapper = panel()
    await wrapper.setProps({ busy: 'open-front' })

    await click(wrapper, 'Lock all')

    expect(wrapper.emitted('send')).toBeUndefined()
  })

  it('offers no alarm toggle at all when there is no status to toggle', () => {
    const wrapper = panel({ status: null, reportedAt: null, stale: true })

    expect(buttonLabels(wrapper)).not.toContain('Arm alarm')
    expect(buttonLabels(wrapper)).not.toContain('Disarm alarm')
  })
})
