import { ApiError } from '@hsl/api-client'
import { mount, renderToString } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { attached, click, fill, optionLabels } from '../test-support/interact.ts'
import { directoryEntries } from '../test-fixtures.ts'
import CardAssignForm from './CardAssignForm.vue'

const base = { cardNumber: '0004B1C7', saving: false, error: null }

describe('CardAssignForm', () => {
  it('names the card being assigned, so nobody assigns the wrong row', async () => {
    const html = await renderToString(CardAssignForm, {
      props: { ...base, members: directoryEntries },
    })

    expect(html).toContain('Assigning card')
    expect(html).toContain('0004B1C7')
  })

  it('offers the members the directory returned, searched the way the directory searches', async () => {
    const html = await renderToString(CardAssignForm, {
      props: { ...base, members: directoryEntries },
    })

    expect(html).toContain('Sam Rivera')
    expect(html).toContain('M. Volkov')
    expect(html).toContain('Search name or email')
  })

  it('asks before sending, rather than assigning on the first click', async () => {
    const html = await renderToString(CardAssignForm, {
      props: { ...base, members: directoryEntries },
    })

    expect(html).toContain('Review')
    expect(html).not.toContain('Yes, assign it')
  })

  it('shows the refusal in the words the API used, and never a status code', async () => {
    const duplicate = ApiError.refused({
      method: 'POST',
      path: '/api/cards',
      status: 409,
      body: {
        error:
          'Card 0004B1C7 is already in slot 041, so no slot was taken. It is already issued. Find it in the card table to see who holds it, rather than assigning it again.',
      },
    })

    const html = await renderToString(CardAssignForm, {
      props: { ...base, members: directoryEntries, error: duplicate },
    })

    expect(html).toContain('already in slot 041, so no slot was taken')
    expect(html).toContain('Find it in the card table')
    expect(html).not.toContain('409')
  })

  it('says the table is full in the API words, which already say what to do', async () => {
    const full = ApiError.refused({
      method: 'POST',
      path: '/api/cards',
      status: 409,
      body: {
        error:
          'Every slot from 0 to 199 holds a card. No card was assigned. Deactivate and remove a card that is out of service, then try again.',
      },
    })

    const html = await renderToString(CardAssignForm, {
      props: { ...base, members: directoryEntries, error: full },
    })

    expect(html).toContain('Every slot from 0 to 199 holds a card.')
    expect(html).toContain('Deactivate and remove a card that is out of service')
  })

  it('says there is nobody to pick when the directory did not load', async () => {
    const html = await renderToString(CardAssignForm, { props: { ...base, members: [] } })

    expect(html).toContain('The member directory did not load')
    expect(html).toContain('Reload this page')
    expect(html).not.toContain('Search name or email')
  })

  it('says a thousand names do not fit in one list', async () => {
    const thousand = Array.from({ length: 1061 }, (_, index) => ({
      ...directoryEntries[0]!,
      id: `mbr_${index}`,
    }))

    const html = await renderToString(CardAssignForm, { props: { ...base, members: thousand } })

    expect(html).toContain('1061 members match')
  })
})

/**
 * Assigning a card takes a slot on a physical controller and gives somebody a
 * way into the building. The form picks the member, the question names them,
 * and nothing is sent until the question is answered.
 */
describe('CardAssignForm, filled in', () => {
  function form() {
    return mount(CardAssignForm, { ...attached, props: { ...base, members: directoryEntries } })
  }

  it('reviews before assigning, so picking a member sends nothing', async () => {
    const wrapper = form()

    await fill(wrapper, 'Member', 'mbr_volkov')
    await click(wrapper, 'Review')

    expect(wrapper.emitted('assign')).toBeUndefined()
    expect(wrapper.text()).toContain('Give card 0004B1C7 to M. Volkov?')
  })

  it('assigns the member who was picked once the question is answered', async () => {
    const wrapper = form()

    await fill(wrapper, 'Member', 'mbr_volkov')
    await click(wrapper, 'Review')
    await click(wrapper, 'Yes, assign it')

    expect(wrapper.emitted('assign')).toEqual([
      [{ userId: 'mbr_volkov', cardNumber: '0004B1C7' }],
    ])
  })

  it('carries a typed label, trimmed, and leaves it out when it is blank', async () => {
    const wrapper = form()

    await fill(wrapper, 'Member', 'mbr_rivera')
    await fill(wrapper, 'Label, optional', '  blue fob  ')
    await click(wrapper, 'Review')
    await click(wrapper, 'Yes, assign it')

    expect(wrapper.emitted('assign')).toEqual([
      [{ userId: 'mbr_rivera', cardNumber: '0004B1C7', label: 'blue fob' }],
    ])
  })

  it('goes back to the form without assigning', async () => {
    const wrapper = form()

    await fill(wrapper, 'Member', 'mbr_rivera')
    await click(wrapper, 'Review')
    await click(wrapper, 'Back')

    expect(wrapper.emitted('assign')).toBeUndefined()
    expect(wrapper.text()).toContain('Search name or email')
  })

  it('narrows the list to what was searched, over name and email both', async () => {
    const wrapper = form()

    await fill(wrapper, 'Search name or email', 'volkov')

    expect(optionLabels(wrapper, 'Member')).toEqual(['Pick a member', 'M. Volkov'])
  })

  it('will not review until a member is picked', async () => {
    const wrapper = form()

    await click(wrapper, 'Review')

    expect(wrapper.text()).not.toContain('Yes, assign it')
  })
})
