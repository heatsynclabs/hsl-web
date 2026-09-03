import type { DoorCommand } from '@hsl/schema'
import { mount, renderToString } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { attached, buttonLabels, click, isDisabled } from '../test-support/interact.ts'
import DoorControls from './DoorControls.vue'

interface ControlProps {
  armed: boolean | null
  busy: DoorCommand | null
  disabled: boolean
}

const base: ControlProps = { armed: true, busy: null, disabled: false }

/**
 * The controls a member uses to open the building from their phone. It is the
 * same shape as the admin door panel and it carries the same risk: the command
 * travels separately from the label, so a mis-paired list opens a door when
 * somebody asked to lock one.
 */
describe('DoorControls', () => {
  function controls(props: Partial<ControlProps> = {}) {
    return mount(DoorControls, { ...attached, props: { ...base, ...props } })
  }

  it.each([
    ['Open front', 'open-front'],
    ['Unlock front', 'unlock-front'],
    ['Lock all', 'lock'],
    ['Disarm alarm', 'disarm'],
  ])('sends %s as %s, and nothing else', async (label, command) => {
    const wrapper = controls()

    await click(wrapper, label)

    expect(wrapper.emitted('send')).toEqual([[command, label]])
  })

  it('sends arm when the alarm is off, so the toggle is not stuck one way', async () => {
    const wrapper = controls({ armed: false })

    await click(wrapper, 'Arm alarm')

    expect(wrapper.emitted('send')).toEqual([['arm', 'Arm alarm']])
  })

  /**
   * The 2018 lab decision. The button stays on the screen so nobody adds it
   * back by mistake, which only works if pressing it does nothing.
   */
  it('sends nothing when the rear unlock button is pressed', async () => {
    const wrapper = controls()

    expect(isDisabled(wrapper, 'Unlock rear')).toBe(true)
    await click(wrapper, 'Unlock rear')

    expect(wrapper.emitted('send')).toBeUndefined()
  })

  it('says why the rear door is refused, in the words on the screen', async () => {
    const html = await renderToString(DoorControls, { props: base })

    expect(html).toContain('2018-02-22')
    expect(html).toContain('Somebody in the building opens that door')
  })

  it('sends nothing at all while the screen is disabled by a stale report', async () => {
    const wrapper = controls({ disabled: true })

    await click(wrapper, 'Open front')
    await click(wrapper, 'Lock all')

    expect(wrapper.emitted('send')).toBeUndefined()
  })

  it('sends nothing while another command is already in flight', async () => {
    const wrapper = controls({ busy: 'open-front' })

    await click(wrapper, 'Lock all')

    expect(wrapper.emitted('send')).toBeUndefined()
  })

  it('names the command in flight on its own button and leaves the rest alone', () => {
    expect(buttonLabels(controls({ busy: 'lock' }))).toEqual([
      'Open front',
      'Unlock front',
      'Sending',
      'Disarm alarm',
      'Unlock rear',
    ])
  })

  it('offers no alarm toggle when the controller has not reported a state', () => {
    const labels = buttonLabels(controls({ armed: null }))

    expect(labels).not.toContain('Arm alarm')
    expect(labels).not.toContain('Disarm alarm')
  })
})
