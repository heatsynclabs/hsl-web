import { mount, renderToString } from '@vue/test-utils'
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

/**
 * Two profile fields hold whatever a member wants to write about what they can
 * do and what they want to learn. A one line box says to write one line.
 */
describe('Field, given room for more than a line', () => {
  it('is a single line box until asked for more', async () => {
    const html = await renderToString(Field, { props: { label: 'Phone' } })

    expect(html).toContain('<input')
    expect(html).not.toContain('<textarea')
  })

  it('becomes a text area, still wired to its own label', async () => {
    const html = await renderToString(Field, { props: { label: 'Skills you have', rows: 4 } })

    expect(html).toContain('<textarea')
    expect(html).toContain('rows="4"')

    const target = html.match(/<label\b[^>]*\bfor="([^"]*)"/)?.[1]
    expect(target).toBeTruthy()
    expect(html).toMatch(new RegExp(`<textarea\\b[^>]*\\bid="${target}"`))
  })

  it('carries back what was typed, line breaks and all', async () => {
    const wrapper = mount(Field, { props: { label: 'Skills you have', rows: 4 } })

    await wrapper.get('textarea').setValue('Laser cutter\nMIG welding')

    expect(wrapper.emitted('update:modelValue')).toEqual([['Laser cutter\nMIG welding']])
  })

  it('marks the text area invalid and points it at the message', async () => {
    const html = await renderToString(Field, {
      props: { label: 'Skills you have', rows: 4, error: 'That is longer than the box holds.' },
    })

    const describedBy = html.match(/<textarea\b[^>]*\baria-describedby="([^"]*)"/)?.[1]

    expect(html).toMatch(/<textarea\b[^>]*\baria-invalid="true"/)
    expect(describedBy).toBeTruthy()
    expect(html).toContain(`id="${describedBy}"`)
  })
})
