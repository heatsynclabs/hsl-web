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
    const wrapper = mount(ProfileForm, {
      ...attached,
      props: { member: { ...SAM, desiredSkills: 'TIG welding' } },
    })

    await wrapper.findAll('textarea')[1]!.setValue('   ')
    await click(wrapper, 'Save changes')

    expect(wrapper.emitted('save')?.[0]?.[0]).toEqual({ desiredSkills: null })
  })
})

/**
 * The form used to send all eleven fields on every save. A member imported from
 * the Rails app can hold a skills answer longer than patchMeRequest accepts, and
 * resending it unchanged took every unrelated edit down with it: they could not
 * fix their phone number until they noticed a box they were not editing.
 */
describe('the profile form, saving', () => {
  it('sends only what the member changed', async () => {
    const wrapper = mount(ProfileForm, { ...attached, props: { member: SAM } })

    await wrapper.get('input[autocomplete="tel"]').setValue('480 555 0199')
    await click(wrapper, 'Save changes')

    expect(wrapper.emitted('save')?.[0]?.[0]).toEqual({ phone: '480 555 0199' })
  })

  it('does not resend a stored answer that is longer than the API accepts', async () => {
    const tooLong = 'a'.repeat(2400)
    const wrapper = mount(ProfileForm, {
      ...attached,
      props: { member: { ...SAM, currentSkills: tooLong } },
    })

    await wrapper.get('input[autocomplete="postal-code"]').setValue('85202')
    await click(wrapper, 'Save changes')

    const sent = wrapper.emitted('save')?.[0]?.[0]
    expect(sent).toEqual({ postalCode: '85202' })
    expect(sent).not.toHaveProperty('currentSkills')
  })

  it('still sends a cleared field, because null is a change', async () => {
    const wrapper = mount(ProfileForm, { ...attached, props: { member: SAM } })

    await wrapper.get('input[autocomplete="tel"]').setValue('  ')
    await click(wrapper, 'Save changes')

    expect(wrapper.emitted('save')?.[0]?.[0]).toEqual({ phone: null })
  })

  it('bounds the skills boxes in the browser at what the schema accepts', () => {
    const wrapper = mount(ProfileForm, { ...attached, props: { member: SAM } })

    for (const box of wrapper.findAll('textarea')) {
      expect(box.attributes('maxlength')).toBe('2000')
    }
  })
})
