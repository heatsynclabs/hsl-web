import { renderToString } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import Field from './Field.vue'

function attribute(html: string, tag: string, name: string): string | undefined {
  const element = html.match(new RegExp(`<${tag}\\b[^>]*>`))
  const found = element?.[0].match(new RegExp(`\\b${name}="([^"]*)"`))
  return found?.[1]
}

describe('Field', () => {
  it('points its label at its own input, so tapping the label focuses the box', async () => {
    const html = await renderToString(Field, { props: { label: 'Email' } })

    const target = attribute(html, 'label', 'for')
    const inputId = attribute(html, 'input', 'id')

    expect(target).toBeTruthy()
    expect(target).toBe(inputId)
  })

  it('gives two fields on one screen different ids', async () => {
    const html = await renderToString({
      components: { Field },
      template: '<form><Field label="Email" /><Field label="Password" type="password" /></form>',
    })

    const ids = [...html.matchAll(/<input\b[^>]*\bid="([^"]*)"/g)].map((m) => m[1])

    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBe(ids[1])
  })

  it('carries no error wiring when there is no error', async () => {
    const html = await renderToString(Field, { props: { label: 'Email' } })

    expect(html).not.toContain('aria-invalid')
    expect(html).not.toContain('aria-describedby')
  })

  it('marks the input invalid and points it at the message when there is an error', async () => {
    const html = await renderToString(Field, {
      props: { label: 'Email', error: 'That email is already registered.' },
    })

    expect(attribute(html, 'input', 'aria-invalid')).toBe('true')

    const describedBy = attribute(html, 'input', 'aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(html).toContain(`id="${describedBy}"`)
    expect(html).toContain('That email is already registered.')
  })
})
