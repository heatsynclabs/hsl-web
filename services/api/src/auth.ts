import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { betterAuth } from 'better-auth'
import bcrypt from 'bcryptjs'

import type { Config } from './config.ts'
import type { Mailer } from './mailer.ts'
import { createMailer, resetPasswordMessage } from './mailer.ts'
import type { Database } from './db.ts'
import { schema } from './db.ts'

/**
 * better-auth 1.7.2, configured against the tables in @hsl/schema. Option names
 * were read from the installed @better-auth/core init-options types rather than
 * from documentation.
 *
 * The plugin list is empty on purpose. The admin plugin was specified, and its
 * schema in dist/plugins/admin/schema.mjs adds role, banned, banReason and
 * banExpires to user and impersonatedBy to session. @hsl/schema has none of
 * those columns, and the drizzle adapter's checkMissingFields throws on any
 * write carrying a field the drizzle table does not define, so sign-up would
 * fail for every member the moment the plugin's banned default was written.
 * Its ban and impersonation endpoints would also be a second, unaudited path to
 * change a member, which decisions/0008-single-admin-plus-audit-log.md rules
 * out. Roles here are the booleans on the member row.
 */

// Cost 10 is what Devise wrote for the 1,030 imported hashes. See
// decisions/0004-keep-bcrypt.md.
const BCRYPT_COST = 10

export type Auth = ReturnType<typeof createAuth>

/** Where app.ts mounts better-auth, and what basePath below tells it. */
export const AUTH_BASE_PATH = '/api/auth'

/**
 * The better-auth routes this system serves. Everything else it mounts under
 * AUTH_BASE_PATH is answered 404 by app.ts.
 *
 * 1.7.2 exposes about thirty endpoints from the emailAndPassword configuration
 * alone, and apps/members/src/lib/auth.ts calls four of them. Two of the rest
 * write to the member row: /update-user sets name and image with no length of
 * its own, past the 200 characters patchMeRequest allows, and /sign-up/email
 * creates a member with no waiver row, which POST /api/signup is the only code
 * that writes. Neither is a route this system means to have, and neither was
 * refused while the handler was mounted as a bare wildcard.
 *
 * An allow list rather than better-auth's own disabledPaths, because a deny
 * list has to be re-read against every upgrade and an endpoint added upstream
 * would be served the day it arrived.
 *
 * POST /api/signup calls auth.api.signUpEmail directly. That does not go
 * through better-auth's router, so joining is unaffected. Read from
 * dist/api/index.mjs, where the router is the only thing that reads a path.
 */
const SERVED_AUTH_PATHS = new Set([
  '/sign-in/email',
  '/sign-out',
  '/request-password-reset',
  '/reset-password',
])

/** The GET the emailed reset link lands on. Its token is a path segment. */
const RESET_PASSWORD_CALLBACK = /^\/reset-password\/[^/]+$/

/**
 * Whether a request under AUTH_BASE_PATH is one better-auth should see.
 *
 * The path is taken from a parsed URL so that a dot segment is resolved before
 * it is matched: /api/auth/reset-password/../update-user reached update-user.
 */
export function servesAuthRequest(url: string): boolean {
  const path = new URL(url).pathname.slice(AUTH_BASE_PATH.length)
  return SERVED_AUTH_PATHS.has(path) || RESET_PASSWORD_CALLBACK.test(path)
}

/**
 * Chosen rather than defaulted. better-auth turns rate limiting on only in
 * production and allows 100 requests per 10 seconds, which is generous
 * enough to walk a password list against a known member address, and off
 * entirely on a staging host.
 *
 * The window is per address in memory, so it resets when this process
 * restarts and is not shared between instances. With one API container that
 * is the whole story. A second container would need the storage option, and
 * a limit at the proxy is worth having either way.
 */
/**
 * Exported so the suite asserts against the number that is configured rather
 * than a literal of its own. A limit the tests disagree with is worse than no
 * limit, because the disagreement is what people learn to ignore.
 */
export const SIGN_IN_ATTEMPTS_PER_MINUTE = 30

const RATE_LIMIT = {
  enabled: true,
  window: 60,
  max: 120,
  customRules: {
    // These are per source address, not per person: better-auth keys the bucket
    // on `ip|path` and nothing configures that away. Everyone signing in from
    // inside the lab shares one public address, so the number has to survive a
    // room, not a person. Thirty a minute covers an orientation night and is
    // still nowhere near walking a password list against bcrypt at cost 10.
    // A successful sign in spends the budget too, because the limiter runs
    // before the handler and does not look at the outcome.
    '/sign-in/email': { window: 60, max: SIGN_IN_ATTEMPTS_PER_MINUTE },
    // Each one sends mail to somebody's inbox. Ten in five minutes from one
    // address, because the 31 imported members with no password have only this
    // way in and they turn up at the same table on the same evening.
    '/request-password-reset': { window: 300, max: 10 },
    '/reset-password': { window: 300, max: 10 },
  },
} as const

export function createAuth(db: Database, config: Config, mailer: Mailer = createMailer(config)) {
  return betterAuth({
    appName: 'HeatSync Labs',
    baseURL: config.publicOrigin,
    basePath: AUTH_BASE_PATH,
    secret: config.authSecret,
    database: drizzleAdapter(db, { provider: 'pg', schema, transaction: true }),
    // Caddy serves the three apps and proxies /api on this one origin, so the
    // list is one entry and never a wildcard.
    trustedOrigins: [config.publicOrigin],
    emailAndPassword: {
      enabled: true,
      password: {
        hash: (password) => bcrypt.hash(password + config.legacyPepper, BCRYPT_COST),
        verify: ({ hash, password }) => bcrypt.compare(password + config.legacyPepper, hash),
      },
      // Without this, better-auth answers RESET_PASSWORD_DISABLED, and the 31
      // imported members who have never had a password would have no way in at
      // all. config.ts refuses to start in production when SMTP is unset, so
      // this cannot silently fall back to writing links into a log file.
      sendResetPassword: async ({ user, url }) => {
        const { subject, text } = resetPasswordMessage(url)
        await mailer.send({ to: user.email, subject, text })
      },
      // Signing every session out on reset is the point of resetting: somebody
      // who reached the account keeps it until their cookie expires otherwise.
      revokeSessionsOnPasswordReset: true,
    },
    rateLimit: RATE_LIMIT,
    advanced: {
      cookiePrefix: 'hsl',
      useSecureCookies: config.useSecureCookies,
    },
    plugins: [],
  })
}
