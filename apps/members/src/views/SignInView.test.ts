import { clearSession } from '@hsl/api-client'
import { renderToString } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import { apiKey } from '../lib/api'
import { stubApi } from '../test-fixtures'
import SignInView from './SignInView.vue'

const BLANK = { template: '<div />' }

async function render(): Promise<string> {
  // A memory router, because createWebHistory needs a browser and these suites
  // have no DOM. The guard is not installed: this test is about the panel.
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'overview', component: BLANK },
      { path: '/sign-in', name: 'sign-in', component: SignInView },
      { path: '/forgot-password', name: 'forgot-password', component: BLANK },
    ],
  })
  await router.push('/sign-in')
  await router.isReady()

  return renderToString(SignInView, {
    global: { plugins: [router], provide: { [apiKey]: stubApi({}) } },
  })
}

afterEach(() => {
  clearSession()
})

describe('the sign in screen', () => {
  it('asks for an email and a password and nothing else', async () => {
    const html = await render()

    expect(html).toContain('type="email"')
    expect(html).toContain('type="password"')
    expect(html).toContain('Continue')
  })

  it('offers the way out for somebody who cannot remember their password', async () => {
    const html = await render()

    expect(html).toContain('Forgot password')
    expect(html).toContain('/forgot-password')
  })

  it('tells an imported member their old password still works', async () => {
    const html = await render()

    expect(html).toContain('the old members site')
    expect(html).toContain("no password was reset")
  })
})
