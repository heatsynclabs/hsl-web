import { renderToString } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

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
