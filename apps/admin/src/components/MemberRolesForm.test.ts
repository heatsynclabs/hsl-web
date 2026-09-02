import { renderToString } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

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
