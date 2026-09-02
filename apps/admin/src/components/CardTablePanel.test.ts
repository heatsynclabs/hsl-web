import { ApiError } from '@hsl/api-client'
import { renderToString } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { cardTableView } from '../test-fixtures.ts'
import CardTablePanel from './CardTablePanel.vue'

const base = { busySlot: null, error: null }

describe('CardTablePanel', () => {
  it('renders the slots the API returned, at the slot numbers it returned', async () => {
    const html = await renderToString(CardTablePanel, { props: { ...base, view: cardTableView } })

    expect(html).toContain('017')
    expect(html).toContain('041')
    expect(html).toContain('0000A1B2')
    expect(html).toContain('Sam Rivera')
  })

  it('counts the table, and names the slot the next card would take', async () => {
    const html = await renderToString(CardTablePanel, { props: { ...base, view: cardTableView } })

    expect(html).toContain('Slots used')
    expect(html).toContain('Slots free')
    expect(html).toContain('198')
    expect(html).toContain('Next free slot')
    expect(html).toContain('000')
  })

  it('marks a slot above 199 as one the reader cannot see rather than hiding it', async () => {
    const html = await renderToString(CardTablePanel, { props: { ...base, view: cardTableView } })

    expect(html).toContain('200')
    expect(html).toContain('Reader cannot see it')
    expect(html).toContain('does not open the door')
  })

  it('flags a row the next pass will clear, and says why', async () => {
    const html = await renderToString(CardTablePanel, { props: { ...base, view: cardTableView } })

    expect(html).toContain('Will be cleared')
    expect(html).toContain('Slot 017 will be cleared on the next pass')
    expect(html).toContain('no longer has card access')
  })

  it('says the table is empty in words that point at the enrolment queue', async () => {
    const empty = { slots: [], usedSlots: 0, freeSlots: 200, nextFreeSlot: 0 }
    const html = await renderToString(CardTablePanel, { props: { ...base, view: empty } })

    expect(html).toContain('No card is in the table.')
  })

  it('says every slot is taken rather than printing nothing for the next one', async () => {
    const full = { ...cardTableView, nextFreeSlot: null }
    const html = await renderToString(CardTablePanel, { props: { ...base, view: full } })

    expect(html).toContain('None. Every slot the reader can scan holds a card.')
  })

  it('prints the API refusal when a deactivation fails', async () => {
    const gone = ApiError.refused({
      method: 'PATCH',
      path: '/api/cards/41',
      status: 404,
      body: { error: 'No card is in slot 41.' },
    })

    const html = await renderToString(CardTablePanel, {
      props: { ...base, view: cardTableView, error: gone },
    })

    expect(html).toContain('No card is in slot 41.')
  })
})
