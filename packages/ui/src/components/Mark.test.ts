import { renderToString } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import Mark from './Mark.vue'

describe('Mark', () => {
  it('inlines the SVG for the name it was given', async () => {
    const html = await renderToString(Mark, { props: { name: 'hsl-mark-1c-current' } })

    expect(html).toContain('<svg')
    expect(html).toContain('fill="currentColor"')
  })

  it('is hidden from screen readers, because the name beside it carries the label', async () => {
    const html = await renderToString(Mark, { props: { name: 'hsl-wordmark-current' } })

    expect(html).toContain('aria-hidden="true"')
  })
})
