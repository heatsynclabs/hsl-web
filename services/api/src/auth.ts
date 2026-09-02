import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { betterAuth } from 'better-auth'
import bcrypt from 'bcryptjs'

import type { Config } from './config.ts'
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

export function createAuth(db: Database, config: Config) {
  return betterAuth({
    appName: 'HeatSync Labs',
    baseURL: config.publicOrigin,
    basePath: '/api/auth',
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
    },
    advanced: {
      cookiePrefix: 'hsl',
      useSecureCookies: config.useSecureCookies,
    },
    plugins: [],
  })
}
