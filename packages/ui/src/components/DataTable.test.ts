import { renderToString } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import DataTable from './DataTable.vue'

const columns = [
  { key: 'slot', label: 'Slot', mono: true },
  { key: 'tag', label: 'Tag', mono: true },
  { key: 'state', label: 'State' },
]

describe('DataTable', () => {
  it('renders every row it is given', async () => {
    const html = await renderToString(DataTable, {
      props: {
        columns,
        rows: [
          { slot: '041', tag: '0000A1B2', state: 'Active' },
          { slot: '009', tag: '0000C4D9', state: 'Active' },
        ],
      },
    })

    expect(html).toContain('041')
    expect(html).toContain('0000A1B2')
    expect(html).toContain('009')
    expect(html.match(/<tr/g)).toHaveLength(3) // one header row plus two card rows
  })

  it('keeps a slot number in the column it was given, never renumbered', async () => {
    const html = await renderToString(DataTable, {
      props: { columns, rows: [{ slot: '200', tag: '000F1E2D', state: 'Active' }] },
    })

    expect(html).toContain('200')
  })

  it('says so plainly when there are no rows', async () => {
    const html = await renderToString(DataTable, {
      props: { columns, rows: [], emptyText: 'No cards yet. Ask an admin.' },
    })

    expect(html).toContain('No cards yet. Ask an admin.')
    expect(html).toContain('colspan="3"')
  })
})
