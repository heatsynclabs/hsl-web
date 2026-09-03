import { mount, renderToString } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { attached, buttonLabels, click, fill } from '../test-support/interact.ts'
import { memberRecord } from '../test-fixtures.ts'
import MemberCertifications from './MemberCertifications.vue'

const catalogue = [
  { id: 1, slug: 'laser', name: 'Laser Cutter', description: null },
  { id: 2, slug: 'tablesaw', name: 'Table Saw', description: null },
]

const base = { saving: false, error: null, catalogue }

describe('MemberCertifications', () => {
  it('renders what the member holds, with who granted it and when', async () => {
    const html = await renderToString(MemberCertifications, {
      props: { ...base, held: memberRecord.certifications },
    })

    expect(html).toContain('Laser Cutter')
    expect(html).toContain('K. Ortiz')
  })

  it('offers only the tools the member does not already hold', async () => {
    const html = await renderToString(MemberCertifications, {
      props: { ...base, held: memberRecord.certifications },
    })

    expect(html).toContain('Table Saw')
    expect(html.match(/Laser Cutter/g)).toHaveLength(1)
  })

  it('says so plainly when nothing has been granted', async () => {
    const html = await renderToString(MemberCertifications, { props: { ...base, held: [] } })

    expect(html).toContain('No certification recorded for this member.')
  })
})

/**
 * An instructor granting and revoking. A certification is what a tool interlock
 * asks about, so revoking the wrong one leaves somebody able to start a machine
 * they were taken off, and granting the wrong one is the same mistake forward.
 */
describe('MemberCertifications, clicked', () => {
  // Two held and two grantable on purpose. With one of each, a component that
  // always sends the first row is indistinguishable from one that sends the row
  // that was pressed, and the test that claims to tell them apart cannot.
  const held = [
    memberRecord.certifications[0]!,
    { ...memberRecord.certifications[0]!, slug: 'migwelder', name: 'Welder (MIG)' },
  ]
  const catalogueOfFour = [
    ...catalogue,
    { id: 3, slug: 'migwelder', name: 'Welder (MIG)', description: null },
    { id: 4, slug: 'biglathe', name: 'Lathe (Big)', description: null },
  ]

  function certifications(saving = false) {
    return mount(MemberCertifications, {
      ...attached,
      props: { ...base, catalogue: catalogueOfFour, saving, held },
    })
  }

  it('revokes the tool on the row that was pressed, not the first one held', async () => {
    const wrapper = certifications()

    await wrapper.findAll('button').filter((b) => b.text() === 'Revoke')[1]!.trigger('click')

    expect(wrapper.emitted('revoke')).toEqual([['migwelder']])
  })

  it('revokes the first row when that is the row pressed', async () => {
    const wrapper = certifications()

    await wrapper.findAll('button').filter((b) => b.text() === 'Revoke')[0]!.trigger('click')

    expect(wrapper.emitted('revoke')).toEqual([['laser']])
  })

  it('revokes nothing while a change is already in flight', async () => {
    const wrapper = certifications(true)

    await click(wrapper, 'Revoke')

    expect(wrapper.emitted('revoke')).toBeUndefined()
  })

  it('grants the tool that was picked, not the first one on offer', async () => {
    const wrapper = certifications()

    await fill(wrapper, 'Grant a certification', 'biglathe')
    await click(wrapper, 'Grant')

    expect(wrapper.emitted('grant')).toEqual([['biglathe']])
  })

  it('grants nothing until a tool is picked', async () => {
    const wrapper = certifications()

    await click(wrapper, 'Grant')

    expect(wrapper.emitted('grant')).toBeUndefined()
  })

  it('offers only the tools this member does not already hold', () => {
    const wrapper = certifications()

    expect(wrapper.findAll('option').map((o) => o.text())).toEqual([
      'Pick a tool',
      'Table Saw',
      'Lathe (Big)',
    ])
  })

  it('names the change in flight on the button rather than leaving it silent', () => {
    expect(buttonLabels(certifications(true))).toContain('Saving')
  })
})
