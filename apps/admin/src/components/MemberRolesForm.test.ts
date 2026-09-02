import { mount, renderToString } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { attached, click, fill, isDisabled } from '../test-support/interact.ts'
import { memberSelf } from '../test-fixtures.ts'
import MemberRolesForm from './MemberRolesForm.vue'

const base = { saving: false, error: null }

describe('MemberRolesForm', () => {
  it('offers the three roles the route can change and nothing else', async () => {
    const html = await renderToString(MemberRolesForm, { props: { ...base, member: memberSelf } })

    expect(html).toContain('Admin')
    expect(html).toContain('Instructor')
    expect(html).toContain('Accountant')
    // Card access is on the same route and is deliberately somewhere else.
    expect(html).not.toContain('Card access')
  })

  it('labels every member level through the rule in @hsl/schema', async () => {
    const html = await renderToString(MemberRolesForm, { props: { ...base, member: memberSelf } })

    expect(html).toContain('Volunteer')
    expect(html).toContain('Associate ($25)')
    expect(html).toContain('Basic ($50)')
    expect(html).toContain('Plus ($100)')
    // 27 production rows carry no level, so the form can put one back.
    expect(html).toContain('Not recorded')
  })

  it('says nothing has changed rather than offering a save that would be refused', async () => {
    const html = await renderToString(MemberRolesForm, { props: { ...base, member: memberSelf } })

    expect(html).toContain('Nothing on this form has changed yet.')
  })
})

/**
 * Making somebody an admin. The form sends only what changed, so a save that
 * carried the untouched fields as well would overwrite a change another admin
 * made between the page loading and the button being pressed.
 */
describe('MemberRolesForm, filled in', () => {
  function form() {
    return mount(MemberRolesForm, { ...attached, props: { ...base, member: memberSelf } })
  }

  it('will not save until something on it has changed', () => {
    const wrapper = form()

    expect(isDisabled(wrapper, 'Save roles and level')).toBe(true)
    expect(wrapper.text()).toContain('Nothing on this form has changed yet')
  })

  it('makes a member an admin, and sends nothing it was not asked to change', async () => {
    const wrapper = form()

    await fill(wrapper, 'Admin', true)
    await click(wrapper, 'Save roles and level')

    expect(wrapper.emitted('save')).toEqual([[{ admin: true }]])
  })

  it('never sends card access, which is a building key with its own control', async () => {
    const wrapper = form()

    await fill(wrapper, 'Instructor', true)
    await fill(wrapper, 'Member level', '100')
    await click(wrapper, 'Save roles and level')

    const sent = wrapper.emitted('save')?.[0]?.[0]
    expect(sent).toEqual({ instructor: true, memberLevel: 100 })
    expect(sent).not.toHaveProperty('cardAccess')
  })

  it('takes a role away again, rather than only ever adding one', async () => {
    const wrapper = mount(MemberRolesForm, {
      ...attached,
      props: { ...base, member: { ...memberSelf, instructor: true } },
    })

    await fill(wrapper, 'Instructor', false)
    await click(wrapper, 'Save roles and level')

    expect(wrapper.emitted('save')).toEqual([[{ instructor: false }]])
  })

  it('goes quiet again when a change is put back the way it was', async () => {
    const wrapper = form()

    await fill(wrapper, 'Admin', true)
    await fill(wrapper, 'Admin', false)

    expect(isDisabled(wrapper, 'Save roles and level')).toBe(true)
  })
})
