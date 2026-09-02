import { ApiError } from '@hsl/api-client'
import { mount, renderToString } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { attached, click } from '../test-support/interact.ts'
import CardAccessControl from './CardAccessControl.vue'

const base = { memberName: 'Sam Rivera', saving: false, error: null }

describe('CardAccessControl', () => {
  it('says whether card access is on, and does not ask the question until asked', async () => {
    const html = await renderToString(CardAccessControl, {
      props: { ...base, cardAccess: false },
    })

    expect(html).toContain('Turn card access on')
    // The confirmation is a second step on purpose. One click must not open a door.
    expect(html).not.toContain('Yes, do it')
  })

  it('offers to take access away from a member who has it', async () => {
    const html = await renderToString(CardAccessControl, { props: { ...base, cardAccess: true } })

    expect(html).toContain('Turn card access off')
  })

  it('shows the refusal the API gave rather than a blank control', async () => {
    const refused = ApiError.refused({
      method: 'PATCH',
      path: '/api/members/mbr_rivera',
      status: 403,
      body: { error: 'That needs an admin. Nothing was changed. Ask an admin to make the change.' },
    })

    const html = await renderToString(CardAccessControl, {
      props: { ...base, cardAccess: false, error: refused },
    })

    expect(html).toContain('That needs an admin.')
  })
})

/**
 * Card access is a building key and the control asks twice. Rendering proves
 * the first question is on the screen and the second is not. Only clicking
 * proves the second cannot be reached without answering the first.
 */
describe('CardAccessControl, clicked', () => {
  it('asks rather than granting, so one click never opens a building', async () => {
    const wrapper = mount(CardAccessControl, { ...attached, props: { ...base, cardAccess: false } })

    await click(wrapper, 'Turn card access on')

    expect(wrapper.emitted('set')).toBeUndefined()
    expect(wrapper.text()).toContain('Give Sam Rivera card access?')
  })

  it('grants it once the second question is answered', async () => {
    const wrapper = mount(CardAccessControl, { ...attached, props: { ...base, cardAccess: false } })

    await click(wrapper, 'Turn card access on')
    await click(wrapper, 'Yes, do it')

    expect(wrapper.emitted('set')).toEqual([[true]])
  })

  it('takes it away from a member who has it, rather than setting it again', async () => {
    const wrapper = mount(CardAccessControl, { ...attached, props: { ...base, cardAccess: true } })

    await click(wrapper, 'Turn card access off')
    await click(wrapper, 'Yes, do it')

    expect(wrapper.emitted('set')).toEqual([[false]])
  })

  it('changes nothing when the question is cancelled', async () => {
    const wrapper = mount(CardAccessControl, { ...attached, props: { ...base, cardAccess: false } })

    await click(wrapper, 'Turn card access on')
    await click(wrapper, 'Cancel')

    expect(wrapper.emitted('set')).toBeUndefined()
    expect(wrapper.text()).toContain('Turn card access on')
  })

  it('will not send a second time while the first is still saving', async () => {
    const wrapper = mount(CardAccessControl, { ...attached, props: { ...base, cardAccess: false } })
    await click(wrapper, 'Turn card access on')
    await wrapper.setProps({ saving: true })

    await click(wrapper, 'Saving')

    expect(wrapper.emitted('set')).toBeUndefined()
  })

  it('drops the stale question when the answer arrives', async () => {
    const wrapper = mount(CardAccessControl, { ...attached, props: { ...base, cardAccess: false } })
    await click(wrapper, 'Turn card access on')

    await wrapper.setProps({ cardAccess: true })

    expect(wrapper.text()).not.toContain('Give Sam Rivera card access?')
    expect(wrapper.text()).toContain('Card access is on')
  })
})
