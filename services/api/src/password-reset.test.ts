import { account, user } from '@hsl/schema'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, expect, it } from 'vitest'

import { createAuth } from './auth.ts'
import { loadConfig } from './config.ts'
import { createDatabase } from './db.ts'
import type { Mailer } from './mailer.ts'
import { resetPasswordMessage } from './mailer.ts'
import { describeDatabase } from './test-support/harness.ts'

/**
 * Thirty-one imported members have an empty password hash. They could not sign
 * in under Rails either, and reset is the only way in for them. It was silently
 * broken once already: better-auth answers RESET_PASSWORD_DISABLED unless
 * sendResetPassword is configured, and the endpoint returned 400 to everybody.
 *
 * These tests are what stops that shipping again.
 */
describeDatabase('password reset', () => {
  const sent: { to: string; subject: string; text: string }[] = []
  const mailer: Mailer = { send: async (message) => void sent.push(message) }

  const config = loadConfig({
    DATABASE_URL: process.env.DATABASE_URL ?? '',
    PUBLIC_ORIGIN: 'http://localhost:3000',
    AUTH_SECRET: 'a test secret that is long enough',
    DOOR_TOKEN: 'a test door token that is long enough',
  })
  const { db, pool } = createDatabase(config)
  const auth = createAuth(db, config, mailer)

  const email = 'no-password@example.test'

  beforeEach(async () => {
    sent.length = 0
    await db.execute(`set session_replication_role = replica`)
    await db.execute(`truncate table "user", account restart identity cascade`)
    await db.execute(`set session_replication_role = default`)

    await db.insert(user).values({
      id: 'never-signed-in',
      name: 'A Member Who Never Set A Password',
      email,
      updatedAt: new Date(),
    })
    // What the import writes for the 31: a member row, and a credential whose
    // hash is the empty string the legacy database held.
    await db.insert(account).values({
      id: 'never-signed-in-credential',
      userId: 'never-signed-in',
      providerId: 'credential',
      issuer: 'local:credential',
      accountId: 'never-signed-in',
      password: '',
    })
  })

  afterAll(async () => {
    await pool.end()
  })

  it('sends a link rather than answering that reset is disabled', async () => {
    await auth.api.requestPasswordReset({ body: { email, redirectTo: '/' } })

    expect(sent).toHaveLength(1)
    expect(sent[0]?.to).toBe(email)
    expect(sent[0]?.text).toContain('/reset-password/')
  })

  it('lets a member with no password set one and sign in with it', async () => {
    await auth.api.requestPasswordReset({ body: { email, redirectTo: '/' } })

    const link = sent[0]?.text.match(/\S*\/reset-password\/\S+/)?.[0] ?? ''
    const token = new URL(link).pathname.split('/').pop() ?? ''
    expect(token).not.toBe('')

    await auth.api.resetPassword({ body: { newPassword: 'a password they chose', token } })

    const signedIn = await auth.api.signInEmail({
      body: { email, password: 'a password they chose' },
    })
    expect(signedIn.user.email).toBe(email)
  })

  it('stores the new password as bcrypt, so the hash format never splits', async () => {
    await auth.api.requestPasswordReset({ body: { email, redirectTo: '/' } })
    const token = new URL(sent[0]?.text.match(/\S*\/reset-password\/\S+/)?.[0] ?? '').pathname
      .split('/')
      .pop()!

    await auth.api.resetPassword({ body: { newPassword: 'a password they chose', token } })

    const rows = await db.select().from(account).where(eq(account.userId, 'never-signed-in'))
    const stored = rows[0]?.password ?? ''

    expect(stored.startsWith('$2')).toBe(true)
    expect(await bcrypt.compare('a password they chose', stored)).toBe(true)
  })

  it('says nothing about whether an address has an account', async () => {
    const answer = await auth.api.requestPasswordReset({
      body: { email: 'nobody-here@example.test', redirectTo: '/' },
    })

    expect(sent).toHaveLength(0)
    expect(answer.status).toBe(true)
  })

  it('writes a message that names the lab and warns the link expires', () => {
    const { subject, text } = resetPasswordMessage('https://example.test/reset-password/abc')

    expect(subject).toContain('HeatSync Labs')
    expect(text).toContain('expires')
    expect(text).toContain('https://example.test/reset-password/abc')
  })
})

/**
 * The guard that stops a deployment shipping without mail. It reads https as the
 * signal that this is a real deployment.
 */
it('refuses to start a public deployment that cannot send mail', () => {
  const environment = {
    DATABASE_URL: 'postgres://hsl@db:5432/hsl',
    PUBLIC_ORIGIN: 'https://members.heatsynclabs.org',
    AUTH_SECRET: 'a test secret that is long enough',
    DOOR_TOKEN: 'a test door token that is long enough',
  }

  expect(() => loadConfig(environment)).toThrow(/SMTP_URL is not set/)
  expect(() => loadConfig({ ...environment, SMTP_URL: 'smtp://localhost:1025' })).not.toThrow()
})

it('allows a laptop with no mail server, because http is not a deployment', () => {
  expect(() =>
    loadConfig({
      DATABASE_URL: 'postgres://hsl@db:5432/hsl',
      PUBLIC_ORIGIN: 'http://localhost:3000',
      AUTH_SECRET: 'a test secret that is long enough',
      DOOR_TOKEN: 'a test door token that is long enough',
    }),
  ).not.toThrow()
})

