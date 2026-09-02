import { ApiError } from '@hsl/api-client'
import { renderToString } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { activeCard, deactivatedCard } from '../test-fixtures.ts'
import MemberCards from './MemberCards.vue'

const base = { saving: false, assignedSlot: null, error: null }

describe('MemberCards', () => {
  it('renders the cards the member record returned, at the slots it returned', async () => {
    const html = await renderToString(MemberCards, {
      props: { ...base, cards: [activeCard, deactivatedCard] },
    })

    expect(html).toContain('041')
    expect(html).toContain('0000A1B2')
    expect(html).toContain('017')
    expect(html).toContain('Deactivated')
  })

  it('says so when the member holds no card', async () => {
    const html = await renderToString(MemberCards, { props: { ...base, cards: [] } })

    expect(html).toContain('No card on this member. Assign one below.')
  })

  it('names the slot that was assigned and says the door hears about it on the next pass', async () => {
    const html = await renderToString(MemberCards, {
      props: { ...base, cards: [activeCard], assignedSlot: 42 },
    })

    expect(html).toContain('slot 042')
    expect(html).toContain('next reconcile pass')
  })

  it('prints the API refusal when every slot is taken, in words an admin can act on', async () => {
    const full = ApiError.refused({
      method: 'POST',
      path: '/api/cards',
      status: 409,
      body: {
        error:
          'Every slot from 0 to 199 holds a card. No card was assigned. Deactivate and remove a card that is out of service, then try again.',
      },
    })

    const html = await renderToString(MemberCards, {
      props: { ...base, cards: [activeCard], error: full },
    })

    expect(html).toContain('Every slot from 0 to 199 holds a card.')
    expect(html).toContain('Deactivate and remove a card that is out of service')
  })
})
