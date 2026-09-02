import { renderToString } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import Pill from './Pill.vue'

describe('Pill', () => {
  it('shows the state it was given', async () => {
    const html = await renderToString(Pill, { props: { state: 'on' }, slots: { default: 'Paid' } })

    expect(html).toContain('pill--on')
    expect(html).toContain('Paid')
  })

  it('is plain when no state is given, so nothing reads as approval by accident', async () => {
    const html = await renderToString(Pill, { slots: { default: 'grant_card' } })

    expect(html).toContain('pill--plain')
    expect(html).not.toContain('pill--on')
  })

  it('marks a hidden field off rather than dropping it', async () => {
    const html = await renderToString(Pill, { props: { state: 'off' }, slots: { default: 'hidden' } })

    expect(html).toContain('pill--off')
  })
})
