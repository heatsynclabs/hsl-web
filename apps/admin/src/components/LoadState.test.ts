import { ApiError } from '@hsl/api-client'
import { renderToString } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import LoadState from './LoadState.vue'

describe('LoadState', () => {
  it('shows the slot the reader is waiting on rather than an empty screen', async () => {
    const html = await renderToString(LoadState, {
      props: { pending: true, error: null },
      slots: { default: 'the table' },
    })

    expect(html).toContain('Reading from the API.')
    expect(html).not.toContain('the table')
  })

  it('replaces a failed screen with what happened and what to do next', async () => {
    const unreachable = ApiError.unreachable({ method: 'GET', path: '/api/members' })

    const html = await renderToString(LoadState, {
      props: { pending: false, error: unreachable },
      slots: { default: 'the table' },
    })

    expect(html).toContain('got no response at all')
    expect(html).toContain('Check that the API is up')
    expect(html).toContain('Try again')
    expect(html).not.toContain('the table')
  })

  it('gets out of the way once the answer arrived', async () => {
    const html = await renderToString(LoadState, {
      props: { pending: false, error: null },
      slots: { default: 'the table' },
    })

    expect(html).toContain('the table')
  })
})
