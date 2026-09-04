import { PROFILE_TEXT_LIMIT, user } from '@hsl/schema'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, expect, it } from 'vitest'

import type { Harness, SignedInMember } from './test-support/harness.ts'
import { addMember, createHarness, describeDatabase, TEST_PASSWORD } from './test-support/harness.ts'

/**
 * better-auth 1.7.2 mounts about thirty endpoints under /api/auth from the
 * emailAndPassword configuration alone. This system calls five of them, and the
 * rest were served to the internet because the handler was mounted as a
 * wildcard.
 *
 * Two of the unused ones write to the member row, which is the table every
 * strict contract in @hsl/schema exists to protect, so each gets its own case
 * here rather than one test over a list.
 */
describeDatabase('the better-auth routes this system does not serve', () => {
  const harness: Harness = createHarness()
  let member: SignedInMember

  beforeEach(async () => {
    await harness.reset()
    member = await addMember(harness)
  })

  afterAll(async () => {
    await harness.close()
  })

  const post = async (path: string, body: unknown, cookie?: string) =>
    await harness.app.request(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
        ...(cookie === undefined ? {} : { cookie }),
      },
      body: JSON.stringify(body),
    })

  it('refuses a signup that would skip the waiver', async () => {
    const response = await post('/api/auth/sign-up/email', {
      name: 'No Release Signed',
      email: 'skipped-the-waiver@example.test',
      password: TEST_PASSWORD,
    })

    expect(response.status).toBe(404)

    const rows = await harness.db
      .select()
      .from(user)
      .where(eq(user.email, 'skipped-the-waiver@example.test'))
    expect(rows).toEqual([])
  })

  it('refuses an edit that would write a name past the length PATCH /api/me allows', async () => {
    const response = await post(
      '/api/auth/update-user',
      { name: 'N'.repeat(PROFILE_TEXT_LIMIT * 2) },
      member.headers.cookie,
    )

    expect(response.status).toBe(404)

    const [row] = await harness.db.select().from(user).where(eq(user.id, member.member.id))
    expect(row?.name).toBe(member.member.name)
  })

  it('refuses a dot segment that walks back out of the one path with a token in it', async () => {
    const response = await post(
      '/api/auth/reset-password/../update-user',
      { name: 'Walked In' },
      member.headers.cookie,
    )

    expect(response.status).toBe(404)

    const [row] = await harness.db.select().from(user).where(eq(user.id, member.member.id))
    expect(row?.name).toBe(member.member.name)
  })

  /**
   * The five paths that are served, one case each.
   *
   * password-reset.test.ts drives auth.api directly, so it proves the library
   * works and nothing about whether a browser can reach it. These are the tests
   * that fail if somebody narrows the allow list and locks the 31 imported
   * members out of the only way in they have.
   *
   * Each expects the status better-auth answers with, not merely something
   * other than 404, so a case cannot pass on the strength of the wrong handler
   * replying.
   */
  it('serves signing in', async () => {
    const response = await post('/api/auth/sign-in/email', {
      email: member.member.email,
      password: TEST_PASSWORD,
    })

    expect(response.status).toBe(200)
  })

  it('serves signing out', async () => {
    const response = await post('/api/auth/sign-out', {}, member.headers.cookie)

    expect(response.status).toBe(200)
  })

  /** An address nobody holds, so this asks for a link without sending one. */
  it('serves asking for a reset link', async () => {
    const response = await post('/api/auth/request-password-reset', {
      email: 'nobody-has-this-address@example.test',
      redirectTo: '/reset-password',
    })

    expect(response.status).toBe(200)
  })

  it('serves setting a new password, which answers on the token rather than on the path', async () => {
    const response = await post('/api/auth/reset-password', {
      token: 'not a token that was ever issued',
      newPassword: 'a password they chose',
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'INVALID_TOKEN' })
  })

  it('serves the link in the email, which carries its token as a path segment', async () => {
    const response = await harness.app.request(
      '/api/auth/reset-password/a-token-shaped-string?callbackURL=/reset-password',
    )

    expect(response.status).toBe(302)
  })
})
