import { renderToString } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { MemberSummary } from '../lib/directory.ts'
import { toRow } from '../lib/directory.ts'
import { directoryEntries } from '../test-fixtures.ts'
import DirectoryTable from './DirectoryTable.vue'

// The table links to the member screen. Routing is not what these assert.
const global = { stubs: { RouterLink: { template: '<a><slot /></a>' } } }

const summaries = new Map<string, MemberSummary>([
  ['mbr_rivera', { activeSlots: [41], cardsOnRecord: 1, holdsCard: true, paymentStatus: 'paid' }],
])

describe('DirectoryTable', () => {
  it('renders the members the API returned', async () => {
    const rows = directoryEntries.map((entry) => toRow(entry, summaries))

    const html = await renderToString(DirectoryTable, {
      props: { rows, unknownText: 'reading', emptyText: 'No member matches that search.' },
      global,
    })

    expect(html).toContain('Sam Rivera')
    expect(html).toContain('J. Tanaka')
    expect(html).toContain('Basic ($50)')
    expect(html).toContain('041')
    expect(html).toContain('Paid')
  })

  it('says a card and dues cell is unread rather than printing a state nobody checked', async () => {
    const rows = [toRow(directoryEntries[1]!, summaries)]

    const html = await renderToString(DirectoryTable, {
      props: { rows, unknownText: 'unavailable', emptyText: 'No member matches that search.' },
      global,
    })

    expect(html).toContain('unavailable')
    expect(html).not.toContain('Paid')
  })

  it('prints its empty text when a search matched nobody', async () => {
    const html = await renderToString(DirectoryTable, {
      props: { rows: [], unknownText: 'reading', emptyText: 'No member matches that search.' },
      global,
    })

    expect(html).toContain('No member matches that search.')
  })
})
