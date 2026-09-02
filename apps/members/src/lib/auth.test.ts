import { afterEach, describe, expect, it, vi } from 'vitest'

import { AuthError, requestPasswordReset, signIn, signOut } from './auth'

function answers(status: number, body: unknown): typeof globalThis.fetch {
  return vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status })),
  ) as unknown as typeof globalThis.fetch
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('signing in', () => {
  it('posts the email and the password to the better-auth route', async () => {
    const fetch = answers(200, { redirect: false, token: 'tok', user: {} })
    vi.stubGlobal('fetch', fetch)

    await signIn('sam@example.org', 'a password')

    expect(fetch).toHaveBeenCalledWith(
      '/api/auth/sign-in/email',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
  })

  it('says what to do next when the pair does not match, and which one is wrong to nobody', async () => {
    vi.stubGlobal(
      'fetch',
      answers(401, { message: 'Invalid email or password', code: 'INVALID_EMAIL_OR_PASSWORD' }),
    )

    const refusal = await signIn('sam@example.org', 'wrong').catch((error: unknown) => error)

    expect(refusal).toBeInstanceOf(AuthError)
    expect((refusal as AuthError).message).toContain('do not match an account')
    expect((refusal as AuthError).message).toContain('password reset')
    expect((refusal as AuthError).message).not.toContain('no account')
  })

  it('says the service did not answer rather than leaving the form silent', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('failed to fetch'))))

    const refusal = await signIn('sam@example.org', 'a password').catch((error: unknown) => error)

    expect(refusal).toBeInstanceOf(AuthError)
    expect((refusal as AuthError).status).toBe(0)
    expect((refusal as AuthError).message).toContain('Nothing was sent')
  })
})

describe('signing out', () => {
  it('posts to the better-auth route', async () => {
    const fetch = answers(200, { success: true })
    vi.stubGlobal('fetch', fetch)

    await signOut()

    expect(fetch).toHaveBeenCalledWith('/api/auth/sign-out', expect.objectContaining({ method: 'POST' }))
  })
})

describe('asking for a password reset', () => {
  it('hands back the answer as the API wrote it, which names no address', async () => {
    vi.stubGlobal(
      'fetch',
      answers(200, { status: true, message: 'If this email exists in our system, check your email for the reset link' }),
    )

    const said = await requestPasswordReset('nobody@example.org')

    expect(said).toContain('If this email exists')
    expect(said).not.toContain('nobody@example.org')
  })

  it('carries the reason through when the server has no mail configured', async () => {
    vi.stubGlobal(
      'fetch',
      answers(400, { message: "Reset password isn't enabled", code: 'RESET_PASSWORD_DISABLED' }),
    )

    const refusal = await requestPasswordReset('sam@example.org').catch((error: unknown) => error)

    expect(refusal).toBeInstanceOf(AuthError)
    expect((refusal as AuthError).message).toContain("Reset password isn't enabled")
    expect((refusal as AuthError).message).toContain('Nothing was changed')
  })
})
