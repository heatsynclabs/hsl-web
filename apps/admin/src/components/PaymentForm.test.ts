import { ApiError } from '@hsl/api-client'
import { mount, renderToString } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { attached, click, fill } from '../test-support/interact.ts'
import { directoryEntries } from '../test-fixtures.ts'
import PaymentForm from './PaymentForm.vue'

const base = { saving: false, error: null, today: '2026-09-01' }

describe('PaymentForm', () => {
  it('offers the members the API returned', async () => {
    const html = await renderToString(PaymentForm, {
      props: { ...base, members: directoryEntries },
    })

    expect(html).toContain('Sam Rivera')
    expect(html).toContain('M. Volkov')
  })

  it('says a thousand names do not fit in one list', async () => {
    const thousand = Array.from({ length: 1061 }, (_, index) => ({
      ...directoryEntries[0]!,
      id: `mbr_${index}`,
    }))

    const html = await renderToString(PaymentForm, { props: { ...base, members: thousand } })

    expect(html).toContain('1061 members match')
    expect(html).toContain('type')
  })

  it('shows the refusal an accountant would get for a member who is gone', async () => {
    const refused = ApiError.refused({
      method: 'POST',
      path: '/api/payments',
      status: 404,
      body: { error: 'That member does not exist. Nothing was recorded.' },
    })

    const html = await renderToString(PaymentForm, {
      props: { ...base, members: directoryEntries, error: refused },
    })

    expect(html).toContain('That member does not exist. Nothing was recorded.')
  })
})

/**
 * Money. The amount is read from what a person typed, so the tests type it.
 */
describe('PaymentForm, filled in', () => {
  function form() {
    return mount(PaymentForm, { ...attached, props: { ...base, members: directoryEntries } })
  }

  it('records dollars as cents, against the member who was picked', async () => {
    const wrapper = form()

    await fill(wrapper, 'Member', 'mbr_tanaka')
    await fill(wrapper, 'Amount, dollars', '25.00')
    await click(wrapper, 'Record payment')

    expect(wrapper.emitted('record')).toEqual([
      [{ userId: 'mbr_tanaka', amountCents: 2500, paidOn: '2026-09-01' }],
    ])
  })

  it('records nothing for an amount that is not money, and says why', async () => {
    const wrapper = form()

    await fill(wrapper, 'Member', 'mbr_tanaka')
    await fill(wrapper, 'Amount, dollars', 'fifty')
    await click(wrapper, 'Record payment')

    expect(wrapper.emitted('record')).toBeUndefined()
    expect(wrapper.text()).toContain('An amount is dollars and cents')
  })

  it('records nothing for an amount of zero', async () => {
    const wrapper = form()

    await fill(wrapper, 'Member', 'mbr_tanaka')
    await fill(wrapper, 'Amount, dollars', '0')
    await click(wrapper, 'Record payment')

    expect(wrapper.emitted('record')).toBeUndefined()
  })

  it('carries a typed note, trimmed, and leaves it out when it is blank', async () => {
    const wrapper = form()

    await fill(wrapper, 'Member', 'mbr_rivera')
    await fill(wrapper, 'Amount, dollars', '50')
    await fill(wrapper, 'Note, optional', '  cash at the door  ')
    await click(wrapper, 'Record payment')

    expect(wrapper.emitted('record')?.[0]?.[0]).toEqual({
      userId: 'mbr_rivera',
      amountCents: 5000,
      paidOn: '2026-09-01',
      note: 'cash at the door',
    })
  })
})
