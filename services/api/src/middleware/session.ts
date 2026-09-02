import { user } from '@hsl/schema'
import { eq } from 'drizzle-orm'
import type { MiddlewareHandler } from 'hono'

import type { AppDeps, AppEnv } from '../context.ts'

/**
 * Resolves the better-auth session and puts the member row on the context.
 *
 * The row is read from the database on every request rather than taken from the
 * session, because the roles that decide authorization are columns on it. An
 * admin who revokes someone's card access should not have to wait for a session
 * to expire before it takes effect.
 */
export function sessionMiddleware(deps: AppDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const session = await deps.auth.api.getSession({ headers: c.req.raw.headers })

    if (session === null) {
      c.set('member', null)
      await next()
      return
    }

    const rows = await deps.db.select().from(user).where(eq(user.id, session.user.id)).limit(1)
    c.set('member', rows[0] ?? null)
    await next()
  }
}
