import { serve } from '@hono/node-server'
import { Hono } from 'hono'

import { doorAccess, member, oriented, role, service, session, type Env } from './auth.ts'
import { config } from './config.ts'
import { log } from './log.ts'
import * as audit from './routes/audit.ts'
import * as certifications from './routes/certifications.ts'
import * as credentials from './routes/credentials.ts'
import * as door from './routes/door.ts'
import * as members from './routes/members.ts'
import * as payments from './routes/payments.ts'
import * as identity from './routes/session.ts'
import * as spaceapi from './routes/spaceapi.ts'
import * as doorService from './routes/service.ts'

const app = new Hono<Env>()

// Session and identity
app.post('/api/login', identity.login)
app.post('/api/logout', session, identity.logout)
app.post('/api/forgot', identity.forgot)
app.post('/api/reset', identity.reset)
app.post('/api/password', member, identity.changePassword)
app.post('/api/token', session, identity.token)
app.get('/.well-known/jwks.json', identity.jwks)
app.get('/healthz', identity.healthz)

// Self
app.get('/api/me', member, members.me)
app.patch('/api/me', member, members.updateMe)
app.get('/api/me/door-events', member, door.myEvents)

// Members
app.post('/api/signup', members.signup)
app.get('/api/members', oriented, members.directory)
app.get('/api/members/:id', role('admin'), members.show)
app.post('/api/members', role('admin'), members.create)
app.patch('/api/members/:id', role('admin'), members.update)
app.delete('/api/members/:id', role('admin'), members.remove)
app.post('/api/members/:id/reset', role('admin'), members.issueReset)

// Certifications
app.get('/api/certifications', member, certifications.list)
app.post('/api/members/:id/certifications', role('instructor'), certifications.grant)
app.delete('/api/members/:id/certifications/:slug', role('instructor'), certifications.revoke)

// Credentials
app.get('/api/credentials', role('admin'), credentials.list)
app.post('/api/credentials', role('admin'), credentials.issue)
app.delete('/api/credentials/:id', role('admin'), credentials.revoke)

// Payments
app.get('/api/members/:id/payments', role('admin'), payments.forMember)
app.post('/api/payments', role('accountant'), payments.record)

// Door, for people
app.get('/api/door', member, door.state)
app.post('/api/door/command', doorAccess, door.command)
app.get('/api/door/events', role('admin'), door.events)

// The record
app.get('/api/audit', role('admin'), audit.list)

// Service tokens
app.get('/api/service-tokens', role('admin'), doorService.listTokens)
app.post('/api/service-tokens', role('admin'), doorService.createToken)
app.delete('/api/service-tokens/:id', role('admin'), doorService.revokeToken)

// Door, for the door service. Under /door rather than /api, so the auth
// boundary is visible in the path and nothing a browser session reaches can
// touch them.
app.get('/door/cards', service('door'), doorService.cards)
app.post('/door/placements', service('door'), doorService.placements)
app.get('/door/commands', service('door'), doorService.commands)
app.post('/door/commands/:id/result', service('door'), doorService.commandResult)
app.post('/door/state', service('door'), doorService.state)
app.post('/door/events', service('door'), doorService.events)

// Public
app.get('/space_api.json', spaceapi.spaceApi)

app.notFound((c) => c.json({ error: 'There is no route here. The list of them is api/src/index.ts.' }, 404))

/**
 * A failed query is a 503 rather than a 500, and /healthz keeps answering, so a
 * database that is down reads as a database that is down rather than as a
 * missing container.
 */
app.onError((error, c) => {
  // A unique index refusing a duplicate is an answer, not a failure. Routes
  // look first and say something specific; this catches the case where two
  // requests looked at the same moment and neither could see the other.
  if ((error as { code?: string }).code === '23505') {
    log({ evt: 'duplicate_refused', path: c.req.path })
    return c.json(
      { error: 'Something already holds that value. Nothing was changed. Look again and retry.' },
      409,
    )
  }

  log({ evt: 'request_failed', path: c.req.path, message: String(error) })
  return c.json(
    { error: 'Something this request needed did not answer. Nothing was changed. Try again.' },
    503,
  )
})

export { app }

// Only when this file is the process, so a test can import the route table
// without a socket coming with it.
if (import.meta.filename === process.argv[1]) {
  serve({ fetch: app.fetch, port: config.port })
  log({ evt: 'listening', port: config.port, issuer: config.issuer })
}
