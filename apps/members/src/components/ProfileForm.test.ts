import { mount, renderToString } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { attached, click } from '../test-support/interact.ts'
import { SAM } from '../test-fixtures'
import ProfileForm from './ProfileForm.vue'

function render(): Promise<string> {
  return renderToString(ProfileForm, { props: { member: SAM } })
}

describe('the profile form', () => {
  it('opens over the fields the member already has', async () => {
    const html = await render()

    expect(html).toContain('value="Sam Rivera"')
    expect(html).toContain('value="480 555 0142"')
    expect(html).toContain('value="85201"')
    expect(html).toContain('value="R. Rivera"')
  })

  it('offers the two visibility flags as the member set them', async () => {
    const html = await render()

    expect(html).toContain('Show my email to other members')
    expect(html).toContain('Show my phone to other members')
  })

  /**
   * The Rails attr_accessible list let a member set accountant, member_level,
   * waiver, orientation and hidden on themself. patchMeRequest in @hsl/schema
   * keeps hidden, which is a privacy flag, and drops the other four.
   */
  it('does not offer the fields an admin owns', async () => {
    const html = await render()

    for (const label of ['Member level', 'Orientation', 'Waiver', 'Accountant', 'Admin']) {
      expect(html).not.toMatch(new RegExp(`<label[^>]*>${label}</label>`))
    }
  })

  it('does not offer the email address, because it is how a member signs in', async () => {
    const html = await render()

    expect(html).not.toContain('value="sam@example.org"')
    expect(html).toContain('not on this form')
  })

  it('names who does own the fields it left out', async () => {
    const html = await render()

    expect(html).toContain('set by an admin and are recorded in the audit log')
  })
})

/**
 * What a member can do and what they want to learn is a paragraph, not a line.
 * Both boxes were single line until packages/ui grew a multi-line one.
 */
describe('the profile form, filled in', () => {
  it('gives the two skills questions room for more than a line', () => {
    const wrapper = mount(ProfileForm, { ...attached, props: { member: SAM } })

    expect(wrapper.findAll('textarea')).toHaveLength(2)
  })

  it('keeps the line breaks a member typed', async () => {
    const wrapper = mount(ProfileForm, { ...attached, props: { member: SAM } })

    await wrapper.findAll('textarea')[0]!.setValue('Laser cutter\nMIG welding')
    await click(wrapper, 'Save changes')

    expect(wrapper.emitted('save')?.[0]?.[0]).toMatchObject({
      currentSkills: 'Laser cutter\nMIG welding',
    })
  })

  it('clears a field the member emptied, rather than saving an empty string', async () => {
    const wrapper = mount(ProfileForm, { ...attached, props: { member: SAM } })

    await wrapper.findAll('textarea')[1]!.setValue('   ')
    await click(wrapper, 'Save changes')

    expect(wrapper.emitted('save')?.[0]?.[0]).toMatchObject({ desiredSkills: null })
  })
})
