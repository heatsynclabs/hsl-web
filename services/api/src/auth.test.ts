import { account, user } from '@hsl/schema'
import bcrypt from 'bcryptjs'
import { testClient } from 'hono/testing'
import { afterAll, beforeEach, expect, it } from 'vitest'

import type { Harness } from './test-support/harness.ts'
import { createHarness, describeDatabase } from './test-support/harness.ts'

/**
 * Nobody resets a password at cutover. The legacy database holds 1,030 bcrypt
 * hashes at cost 10 with the $2a$ prefix, written by Devise, and better-auth is
 * configured to verify them as they are. See decisions/0004-keep-bcrypt.md.
 *
 * The rows here are written the way the import writes them, so this is a test
 * of the import contract as much as of the auth configuration.
 */
describeDatabase('an imported member signing in', () => {
  const harness: Harness = createHarness()
  const client = testClient(harness.app)

  const password = 'the password they have always used'
  const email = 'imported@example.test'

  beforeEach(async () => {
    await harness.reset()

    await harness.db.insert(user).values({
      id: 'imported-member',
      name: 'An Imported Member',
      email,
      legacyId: 417,
    })

    await harness.db.insert(account).values({
      id: 'imported-credential',
      userId: 'imported-member',
      providerId: 'credential',
      issuer: 'local:credential',
      accountId: 'imported-member',
      password: devisePasswordHash(password),
    })
  })

  afterAll(async () => {
    await harness.close()
  })

  it('accepts the password Devise hashed', async () => {
    const signedIn = await harness.auth.api.signInEmail({
      body: { email, password },
      returnHeaders: true,
    })

    expect(signedIn.response.user.email).toBe(email)

    const cookie = signedIn.headers
      .getSetCookie()
      .map((entry) => entry.split(';')[0])
      .join('; ')
    const me = await client.api.me.$get({}, { headers: { cookie } })

    expect(me.status).toBe(200)
  })

  it('refuses a wrong password', async () => {
    await expect(
      harness.auth.api.signInEmail({ body: { email, password: 'not the password' } }),
    ).rejects.toThrow()
  })

  /** 31 legacy rows carry an empty encrypted_password. They could not sign in before either. */
  it('refuses an account whose stored hash is the empty string', async () => {
    await harness.db.insert(user).values({
      id: 'no-credential',
      name: 'Never Set A Password',
      email: 'nopassword@example.test',
    })
    await harness.db.insert(account).values({
      id: 'empty-credential',
      userId: 'no-credential',
      providerId: 'credential',
      issuer: 'local:credential',
      accountId: 'no-credential',
      password: '',
    })

    await expect(
      harness.auth.api.signInEmail({ body: { email: 'nopassword@example.test', password: '' } }),
    ).rejects.toThrow()
  })
})

/**
 * bcryptjs writes the $2b$ prefix. Devise wrote $2a$, and for these passwords
 * the two differ in the prefix alone, so the fixture is rewritten to match what
 * the dump actually holds rather than what this library prefers to write.
 */
function devisePasswordHash(password: string): string {
  const hash = bcrypt.hashSync(password, 10)
  return hash.replace(/^\$2b\$/, '$2a$')
}
