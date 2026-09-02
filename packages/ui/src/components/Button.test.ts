import { renderToString } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import Button from './Button.vue'

describe('Button', () => {
  it('is a button element by default, so Enter and Space work without help', async () => {
    const html = await renderToString(Button, { props: {}, slots: { default: 'Open front' } })

    expect(html).toMatch(/^<button/)
    expect(html).toContain('type="button"')
    expect(html).toContain('Open front')
  })

  it('is an anchor when given an href, so the browser can follow it', async () => {
    const html = await renderToString(Button, {
      props: { href: '/cards' },
      slots: { default: 'My cards' },
    })

    expect(html).toMatch(/^<a/)
    expect(html).toContain('href="/cards"')
  })

  it('refuses the click when disabled', async () => {
    const html = await renderToString(Button, {
      props: { disabled: true },
      slots: { default: 'Unlock rear' },
    })

    expect(html).toMatch(/<button[^>]*\sdisabled[\s>]/)
    expect(html).toContain('aria-disabled="true"')
  })

  it('drops the href when a disabled link is rendered, so there is nothing to follow', async () => {
    const html = await renderToString(Button, {
      props: { href: '/door/unlock-rear', disabled: true },
      slots: { default: 'Unlock rear' },
    })

    expect(html).not.toContain('href=')
    expect(html).toContain('aria-disabled="true"')
  })
})
