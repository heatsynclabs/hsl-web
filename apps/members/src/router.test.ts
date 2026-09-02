import { clearSession, loadSession } from '@hsl/api-client'
import type { RouteLocationNormalizedGeneric } from 'vue-router'
import { afterEach, describe, expect, it } from 'vitest'

import { nextRoute } from './router'
import { SAM_ME, stubApi } from './test-fixtures'

/** The guard reads two fields off the target, so a test supplies two fields. */
function target(name: string, fullPath: string): RouteLocationNormalizedGeneric {
  return { name, fullPath } as RouteLocationNormalizedGeneric
}

afterEach(() => {
  clearSession()
})

describe('the router guard', () => {
  it('sends an anonymous visitor to sign in, remembering where they were going', () => {
    clearSession()

    expect(nextRoute(target('door', '/door'))).toEqual({
      name: 'sign-in',
      query: { next: '/door' },
    })
  })

  it('lets an anonymous visitor reach sign in and the reset form', () => {
    clearSession()

    expect(nextRoute(target('sign-in', '/sign-in'))).toBe(true)
    expect(nextRoute(target('forgot-password', '/forgot-password'))).toBe(true)
  })

  it('keeps a signed in member off the sign in screen', async () => {
    clearSession()
    await loadSession(stubApi({ me: () => Promise.resolve(SAM_ME) }))

    expect(nextRoute(target('sign-in', '/sign-in'))).toEqual({ name: 'overview' })
  })

  it('lets a signed in member through to the door', async () => {
    clearSession()
    await loadSession(stubApi({ me: () => Promise.resolve(SAM_ME) }))

    expect(nextRoute(target('door', '/door'))).toBe(true)
  })
})
