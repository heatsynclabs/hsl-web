import type { ErrorResponse } from '@hsl/schema'
import type { Context } from 'hono'
import { Hono } from 'hono'

import { AUTH_BASE_PATH, servesAuthRequest } from './auth.ts'
import type { AppDeps, AppEnv } from './context.ts'
import { sessionMiddleware } from './middleware/session.ts'
import { auditRoutes } from './routes/audit.ts'
import { cardRoutes } from './routes/cards.ts'
import { certificationRoutes } from './routes/certifications.ts'
import { doorAdminRoutes } from './routes/door-admin.ts'
import { doorRoutes } from './routes/door.ts'
import { meRoutes } from './routes/me.ts'
import { memberRoutes } from './routes/members.ts'
import { paymentRoutes } from './routes/payments.ts'
import { signupRoutes } from './routes/signup.ts'
import { spaceApiRoutes } from './routes/space-api.ts'

/**
 * The app, built from what it is given so a test can hand it a real database
 * and no port. main.ts is the only place that reads the environment.
 *
 * Order matters. better-auth handles its own routes before anything else, so
 * signing in does not first resolve a session it does not have. Everything
 * after that runs with the member on the context, or null.
 *
 * It handles the four routes this system calls and the one the emailed reset
 * link lands on, and nothing else it mounts. SERVED_AUTH_PATHS in auth.ts says
 * why.
 */
export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>()
    // Liveness only. It answers while the process is up, and deliberately does
    // not check Postgres: a database blip should not restart the container.
    .get('/healthz', (c) => c.json({ ok: true }))
    .all(`${AUTH_BASE_PATH}/*`, (c) => {
      if (!servesAuthRequest(c.req.url)) return notFound(c)
      return deps.auth.handler(c.req.raw)
    })
    .use('*', sessionMiddleware(deps))
    .route('/', meRoutes(deps))
    .route('/', signupRoutes(deps))
    .route('/', memberRoutes(deps))
    .route('/', cardRoutes(deps))
    .route('/', certificationRoutes(deps))
    .route('/', paymentRoutes(deps))
    .route('/', auditRoutes(deps))
    .route('/', doorRoutes(deps))
    .route('/', doorAdminRoutes(deps))
    .route('/', spaceApiRoutes(deps))

  app.notFound(notFound)

  app.onError((error, c) => {
    console.error(`[api] ${c.req.method} ${c.req.path} failed: ${logSafeError(error)}`)
    const body: ErrorResponse = {
      error:
        'The request failed and nothing was changed. Try again, and tell an admin if it keeps happening.',
    }
    return c.json(body, 500)
  })

  return app
}

export type App = ReturnType<typeof createApp>

/**
 * What a failed request is allowed to write to the log.
 *
 * Logging the error object put every bind parameter there: drizzle carries them
 * in the message and again in `params`, and pg puts the offending value in
 * `detail`. On this system a bind parameter is a member's name, address and
 * emergency contact, or a session token, or a password reset token, and
 * `make logs` is how docs/operations.md tells a volunteer to look at the
 * system. The statement is kept, because it is parameterised and says what was
 * being attempted, and so are the Postgres error code, table and constraint,
 * because those are what somebody needs to fix it.
 */
export function logSafeError(error: unknown): string {
  if (!(error instanceof Error)) return 'a thrown value that was not an Error'

  const statement = error.message.split('\nparams:')[0] ?? ''
  const cause = postgresCause(error.cause)
  const described = cause === null ? statement : `${statement} (${cause})`

  return [`${error.name}: ${described}`, ...frames(error)].join('\n')
}

/**
 * The stack without its first line. That line is the message, which carries the
 * bind parameters; the frames below it are file names and are what says where
 * the failure was.
 */
function frames(error: Error): string[] {
  return (error.stack ?? '')
    .split('\n')
    .filter((line) => line.trimStart().startsWith('at '))
    .slice(0, STACK_FRAMES)
}

/** Enough to find the route and the call, without filling the log with runtime internals. */
const STACK_FRAMES = 6

/** The parts of a Postgres error that describe the failure rather than the row. */
function postgresCause(cause: unknown): string | null {
  if (typeof cause !== 'object' || cause === null) return null

  const fields = cause as { code?: unknown; table?: unknown; constraint?: unknown }
  const named = [
    typeof fields.code === 'string' ? `code ${fields.code}` : null,
    typeof fields.table === 'string' ? `table ${fields.table}` : null,
    typeof fields.constraint === 'string' ? `constraint ${fields.constraint}` : null,
  ].filter((part) => part !== null)

  return named.length === 0 ? null : named.join(', ')
}

function notFound(c: Context<AppEnv>) {
  const body: ErrorResponse = { error: 'There is no route at that path.' }
  return c.json(body, 404)
}
