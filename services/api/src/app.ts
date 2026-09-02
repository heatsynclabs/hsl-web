import type { ErrorResponse } from '@hsl/schema'
import { Hono } from 'hono'

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
 */
export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>()
    // Liveness only. It answers while the process is up, and deliberately does
    // not check Postgres: a database blip should not restart the container.
    .get('/healthz', (c) => c.json({ ok: true }))
    .all('/api/auth/*', (c) => deps.auth.handler(c.req.raw))
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

  app.notFound((c) => {
    const body: ErrorResponse = { error: 'There is no route at that path.' }
    return c.json(body, 404)
  })

  app.onError((error, c) => {
    console.error('[api] unhandled error', error)
    const body: ErrorResponse = {
      error:
        'The request failed and nothing was changed. Try again, and tell an admin if it keeps happening.',
    }
    return c.json(body, 500)
  })

  return app
}

export type App = ReturnType<typeof createApp>
