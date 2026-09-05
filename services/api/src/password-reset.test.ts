import { account, user } from '@hsl/schema'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, expect, it } from 'vitest'

import { createAuth } from './auth.ts'
import { loadConfig } from './config.ts'
import { createDatabase } from './db.ts'
import type { Mailer } from './mailer.ts'
import { resetPasswordMessage } from './mailer.ts'
import { describeDatabase, testConfig } from './test-support/harness.ts'

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

  // Vitest runs a skipped describe's body to collect the names inside it, so
  // this has to survive an unset DATABASE_URL. testConfig substitutes a URL
  // nothing connects to.
  const config = testConfig()
  const { db, pool } = createDatabase(config)
  const auth = createAuth(db, config, mailer)

  const email = 'no-password@example.test'

  beforeEach(async () => {
    sent.length = 0
    await db.execute(`set session_replication_role = replica`)
    await db.execute(`truncate table "user", account restart identity cascade`)
    await db.execute(`set session_replication_role = default`)

    // What the import writes for the 31: a member row and no credential at all.
    // tools/import/load.ts skips the account row when the legacy hash is blank,
    // which is why the import reconciles 1,030 credentials against 1,061
    // members. This fixture used to add a credential holding the empty string,
    // a shape the import cannot produce, so the reset these members depend on
    // was only ever proved against something else.
    await db.insert(user).values({
      id: 'never-signed-in',
      name: 'A Member Who Never Set A Password',
      email,
      updatedAt: new Date(),
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

  it('creates the credential the member never had, rather than needing one to exist', async () => {
    const before = await db.select().from(account).where(eq(account.userId, 'never-signed-in'))
    expect(before, 'the fixture stopped matching what the import writes').toEqual([])

    await auth.api.requestPasswordReset({ body: { email, redirectTo: '/' } })
    const link = sent[0]?.text.match(/\S*\/reset-password\/\S+/)?.[0] ?? ''
    const token = new URL(link).pathname.split('/').pop() ?? ''
    await auth.api.resetPassword({ body: { newPassword: 'a password they chose', token } })

    const after = await db.select().from(account).where(eq(account.userId, 'never-signed-in'))
    expect(after).toHaveLength(1)
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
  expect(() => loadConfig({ ...environment, SMTP_URL: 'smtps://user:pw@smtp.example.org:465' })).not.toThrow()
})

/**
 * `make secrets` writes smtp://mail:1025, the development mail catcher, into
 * secrets/smtp_url. The guard above only asked whether SMTP_URL was set, and a
 * placeholder is set, so a deployment where nobody replaced that one file
 * started cleanly, answered every reset request with success, and posted the
 * mail into a web inbox nobody reads. The 31 imported members for whom reset is
 * the only way in were locked out with nothing in any log to say so.
 *
 * `mail` is the compose service name of the catcher and resolves nowhere else,
 * so refusing it has no false positive. A real relay on localhost is left
 * alone: some hosts do run one.
 */
it('refuses the development mail catcher on a public deployment', () => {
  const environment = {
    DATABASE_URL: 'postgres://hsl@db:5432/hsl',
    PUBLIC_ORIGIN: 'https://members.heatsynclabs.org',
    AUTH_SECRET: 'a test secret that is long enough',
    DOOR_TOKEN: 'a test door token that is long enough',
  }

  expect(() => loadConfig({ ...environment, SMTP_URL: 'smtp://mail:1025' })).toThrow(
    /secrets\/smtp_url/,
  )
})

it('lets a laptop keep pointing at the mail catcher, because http is not a deployment', () => {
  expect(() =>
    loadConfig({
      DATABASE_URL: 'postgres://hsl@db:5432/hsl',
      PUBLIC_ORIGIN: 'http://localhost:9080',
      AUTH_SECRET: 'a test secret that is long enough',
      DOOR_TOKEN: 'a test door token that is long enough',
      SMTP_URL: 'smtp://mail:1025',
    }),
  ).not.toThrow()
})

/**
 * SMTP_URL was `z.string().min(1)`, so a value with no scheme reached
 * nodemailer, which threw at boot from inside createTransport. Refusing it here
 * names the variable and the file; the value is never printed, because it
 * carries the relay password.
 */
it('refuses an SMTP_URL that is not a URL, without printing it', () => {
  const environment = {
    DATABASE_URL: 'postgres://hsl@db:5432/hsl',
    PUBLIC_ORIGIN: 'https://members.heatsynclabs.org',
    AUTH_SECRET: 'a test secret that is long enough',
    DOOR_TOKEN: 'a test door token that is long enough',
    SMTP_URL: 'smtp.example.org:465:hunter2',
  }

  expect(() => loadConfig(environment)).toThrow(/SMTP_URL/)
  expect(() => loadConfig(environment)).not.toThrow(/hunter2/)
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

