import { ApiError } from '@hsl/api-client'
import { mount, renderToString } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { attached, click, fill } from '../test-support/interact.ts'
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

/**
 * The same two building-key actions as the card table, reached from a member's
 * own record instead. Both were covered only by rendering, so neither the slot
 * that gets deactivated nor the number that gets assigned was proven.
 */
describe('MemberCards, clicked', () => {
  function cards(saving = false) {
    return mount(MemberCards, {
      ...attached,
      props: { ...base, saving, cards: [deactivatedCard, activeCard] },
    })
  }

  it('deactivates the slot on the row that was pressed', async () => {
    const wrapper = cards()

    await click(wrapper, 'Deactivate')

    expect(wrapper.emitted('deactivate')).toEqual([[activeCard.slot]])
  })

  it('offers Deactivate on the active card and not on the deactivated one', () => {
    expect(cards().findAll('button').filter((b) => b.text() === 'Deactivate')).toHaveLength(1)
  })

  it('deactivates nothing while a change is already in flight', async () => {
    const wrapper = cards(true)

    await click(wrapper, 'Deactivate')

    expect(wrapper.emitted('deactivate')).toBeUndefined()
  })

  it('assigns the number that was typed, padded to the width the controller writes', async () => {
    const wrapper = cards()

    await fill(wrapper, 'Card number, hex', 'a1b2')
    await click(wrapper, 'Assign card')

    expect(wrapper.emitted('assign')).toEqual([[{ cardNumber: '0000A1B2' }]])
  })

  it('carries a typed label, trimmed', async () => {
    const wrapper = cards()

    await fill(wrapper, 'Card number, hex', '4b1c7')
    await fill(wrapper, 'Label, optional', '  blue fob  ')
    await click(wrapper, 'Assign card')

    expect(wrapper.emitted('assign')).toEqual([
      [{ cardNumber: '0004B1C7', label: 'blue fob' }],
    ])
  })

  it('sends nothing for a number that is not hex, and says what to type', async () => {
    const wrapper = cards()

    await fill(wrapper, 'Card number, hex', 'not a card')
    await click(wrapper, 'Assign card')

    expect(wrapper.emitted('assign')).toBeUndefined()
    expect(wrapper.text()).toContain('up to eight hex characters')
  })
})
