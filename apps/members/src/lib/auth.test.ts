import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * better-auth's client captures globalThis.fetch when it is built, which
 * happens the first time lib/auth.ts is imported. So each test stands its fetch
 * up first and then imports a fresh copy of the module, and the client inside
 * it is the one holding the stub. Without the reset the first test's stub would
 * serve every later one.
 */
async function withFetch(fetch: typeof globalThis.fetch) {
  vi.resetModules()
  vi.stubGlobal('fetch', fetch)
  return await import('./auth')
}

function answers(status: number, body: unknown): typeof globalThis.fetch {
  return vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status })),
  ) as unknown as typeof globalThis.fetch
}

function refuses(): typeof globalThis.fetch {
  return vi.fn(() => Promise.reject(new TypeError('failed to fetch'))) as unknown as typeof globalThis.fetch
}

/** The path better-auth asked for, without the origin jsdom happens to run on. */
function pathOf(fetch: typeof globalThis.fetch): string {
  const asked = vi.mocked(fetch).mock.calls[0]?.[0]
  return new URL(String(asked)).pathname
}

function optionsOf(fetch: typeof globalThis.fetch): RequestInit {
  return vi.mocked(fetch).mock.calls[0]?.[1] ?? {}
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('signing in', () => {
  it('posts to the sign in route better-auth serves, with the session cookie', async () => {
    const fetch = answers(200, { redirect: false, token: 'tok', user: {} })
    const { signIn } = await withFetch(fetch)

    await signIn('sam@example.org', 'a password')

    expect(pathOf(fetch)).toBe('/api/auth/sign-in/email')
    expect(optionsOf(fetch).method).toBe('POST')
    expect(optionsOf(fetch).credentials).toBe('include')
    expect(String(optionsOf(fetch).body)).toContain('sam@example.org')
  })

  it('says what to do next when the pair does not match, and which one is wrong to nobody', async () => {
    const { AuthError, signIn } = await withFetch(
      answers(401, { message: 'Invalid email or password', code: 'INVALID_EMAIL_OR_PASSWORD' }),
    )

    const refusal = await signIn('sam@example.org', 'wrong').catch((error: unknown) => error)

    expect(refusal).toBeInstanceOf(AuthError)
    expect((refusal as Error).message).toContain('do not match an account')
    expect((refusal as Error).message).toContain('password reset')
    expect((refusal as Error).message).not.toContain('no account')
  })

  it('says the service did not answer rather than leaving the form silent', async () => {
    const { AuthError, signIn } = await withFetch(refuses())

    const refusal = await signIn('sam@example.org', 'a password').catch((error: unknown) => error)

    expect(refusal).toBeInstanceOf(AuthError)
    expect((refusal as { status: number }).status).toBe(0)
    expect((refusal as Error).message).toContain('Nothing was sent')
  })
})

describe('signing out', () => {
  it('posts to the better-auth route', async () => {
    const fetch = answers(200, { success: true })
    const { signOut } = await withFetch(fetch)

    await signOut()

    expect(pathOf(fetch)).toBe('/api/auth/sign-out')
    expect(optionsOf(fetch).method).toBe('POST')
  })
})

describe('asking for a password reset', () => {
  it('hands back the answer as the API wrote it, which names no address', async () => {
    const { requestPasswordReset } = await withFetch(
      answers(200, {
        status: true,
        message: 'If this email exists in our system, check your email for the reset link',
      }),
    )

    const said = await requestPasswordReset('nobody@example.org')

    expect(said).toContain('If this email exists')
    expect(said).not.toContain('nobody@example.org')
  })

  it('sends where the emailed link should land, or it lands nowhere', async () => {
    const fetch = answers(200, { status: true })
    const { requestPasswordReset } = await withFetch(fetch)

    await requestPasswordReset('sam@example.org')

    expect(pathOf(fetch)).toBe('/api/auth/request-password-reset')
    expect(String(optionsOf(fetch).body)).toContain('/reset-password')
  })

  it('carries the reason through when the server has no mail configured', async () => {
    const { AuthError, requestPasswordReset } = await withFetch(
      answers(400, { message: "Reset password isn't enabled", code: 'RESET_PASSWORD_DISABLED' }),
    )

    const refusal = await requestPasswordReset('sam@example.org').catch((error: unknown) => error)

    expect(refusal).toBeInstanceOf(AuthError)
    expect((refusal as Error).message).toContain("Reset password isn't enabled")
    expect((refusal as Error).message).toContain('Nothing was changed')
  })
})

/**
 * The second half of the reset, and the only way in for the 31 imported members
 * who have never had a password.
 */
describe('setting a new password from the emailed link', () => {
  it('posts the token and the new password to better-auth', async () => {
    const fetch = answers(200, { status: true })
    const { resetPassword } = await withFetch(fetch)

    await resetPassword('a-token-from-the-email', 'a password they chose')

    expect(pathOf(fetch)).toBe('/api/auth/reset-password')
    expect(String(optionsOf(fetch).body)).toContain('a-token-from-the-email')
  })

  it('says the link is spent in the words better-auth used', async () => {
    const { AuthError, resetPassword } = await withFetch(
      answers(400, { message: 'invalid token', code: 'INVALID_TOKEN' }),
    )

    const refusal = await resetPassword('spent', 'a password they chose').catch(
      (error: unknown) => error,
    )

    expect(refusal).toBeInstanceOf(AuthError)
    expect((refusal as Error).message).toContain('invalid token')
  })
})
