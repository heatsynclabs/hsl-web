import { renderToString } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'

const Probe = defineComponent({
  async setup() {
    const value = await Promise.resolve('resolved value')
    return () => h('p', value)
  },
})

describe('probe', () => {
  it('resolves async setup', async () => {
    const html = await renderToString(Probe)
    expect(html).toContain('resolved value')
  })
})
