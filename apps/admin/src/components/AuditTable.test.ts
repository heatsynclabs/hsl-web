import { renderToString } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { auditEntries } from '../test-fixtures.ts'
import AuditTable from './AuditTable.vue'

const global = { stubs: { RouterLink: { template: '<a><slot /></a>' } } }

describe('AuditTable', () => {
  it('renders the entries the API returned, newest first', async () => {
    const html = await renderToString(AuditTable, {
      props: { entries: auditEntries, names: new Map([['mbr_rivera', 'Sam Rivera']]) },
      global,
    })

    expect(html).toContain('card.assign')
    expect(html).toContain('D. Kim')
    expect(html).toContain('slot 042')
    expect(html.indexOf('card.assign')).toBeLessThan(html.indexOf('member.update'))
  })

  it('shows what a change was before it changed', async () => {
    const html = await renderToString(AuditTable, {
      props: { entries: auditEntries, names: new Map() },
      global,
    })

    expect(html).toContain('cardAccess true, was false')
  })

  it('falls back to the member id when the directory does not carry the name', async () => {
    const html = await renderToString(AuditTable, {
      props: { entries: auditEntries, names: new Map() },
      global,
    })

    expect(html).toContain('mbr_tanaka')
  })

  it('says so plainly when nothing has been changed yet', async () => {
    const html = await renderToString(AuditTable, {
      props: { entries: [], names: new Map() },
      global,
    })

    expect(html).toContain('Nothing has been changed yet.')
  })
})
