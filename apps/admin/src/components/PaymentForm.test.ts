import { ApiError } from '@hsl/api-client'
import { renderToString } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

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
