import { randomBytes } from 'node:crypto'

import type { Handler } from 'hono'

import { getCookie } from 'hono/cookie'

import {
  byEmail,
  COOKIE,
  createSession,
  destroySession,
  hashPassword,
  overRateLimit,
  verifyPassword,
  type Env,
  type Member,
} from '../auth.ts'
import { sql } from '../db.ts'
import { bad, body, text } from '../http.ts'
import { log } from '../log.ts'
import { sendResetLink } from '../mail.ts'
import { issueToken, publicKeys } from '../tokens.ts'

/** The same answer whether the address exists or not, and the same time. */
const WRONG = 'That email and password do not go together.'
const TOO_MANY = 'Too many attempts. Try again in a quarter of an hour.'

/** A reset link works once and stops working after this. */
const RESET_MINUTES = 60

export const login: Handler<Env> = async (c) => {
  const form = await body(c)
  const email = text(form.email, 320)
  const password = typeof form.password === 'string' ? form.password : ''

  if (overRateLimit(c, email)) return c.json({ error: TOO_MANY }, 429)
  if (email === null) return bad(c, 'Send an email and a password.')

  const member = await byEmail(email)
  if (!(await verifyPassword(member, password)) || member === null) {
    log({ evt: 'login_fail', email })
    return c.json({ error: WRONG }, 401)
  }

  await createSession(c, member.id)
  log({ evt: 'login_ok', member: member.id })
  return c.json(self(member))
}

export const logout: Handler<Env> = async (c) => {
  await destroySession(c)
  return c.body(null, 204)
}

/**
 * Always 204, whether or not the address belongs to anybody. Answering
 * differently turns this into a test for membership that anyone can run.
 */
export const forgot: Handler<Env> = async (c) => {
  const email = text((await body(c)).email, 320)
  if (overRateLimit(c, email)) return c.json({ error: TOO_MANY }, 429)
  if (email === null) return c.body(null, 204)

  const member = await byEmail(email)
  if (member !== null) {
    const token = randomBytes(32).toString('base64url')
    await sql`
      update members set reset_token = ${token},
                         reset_expires = now() + ${`${RESET_MINUTES} minutes`}::interval,
                         updated_at = now()
      where id = ${member.id}`
    // Not awaited. Sending takes far longer than not sending, so waiting for it
    // answers "is this address a member" to anybody with a stopwatch, and an
    // SMTP server that is down would turn this into a 503 for members who exist
    // and a 204 for everybody else.
    void sendResetLink(member.email, token)
  }

  return c.body(null, 204)
}

export const reset: Handler<Env> = async (c) => {
  const form = await body(c)
  const token = text(form.token, 200)
  const password = typeof form.password === 'string' ? form.password : ''

  if (token === null) return bad(c, 'Send the token from the link and a new password.')
  const weak = tooWeak(password)
  if (weak !== null) return bad(c, weak)

  const [member] = await sql<Member[]>`
    select * from members where reset_token = ${token} and reset_expires > now()`
  if (member === undefined) {
    return bad(c, 'That link has already been used or has expired. Ask for another one.')
  }

  await setPassword(member.id, password)
  log({ evt: 'password_changed', member: member.id, by: 'reset' })
  return c.body(null, 204)
}

export const changePassword: Handler<Env> = async (c) => {
  const me = c.get('member')
  const form = await body(c)
  const current = typeof form.current === 'string' ? form.current : ''
  const next = typeof form.next === 'string' ? form.next : ''

  const weak = tooWeak(next)
  if (weak !== null) return bad(c, weak)
  if (!(await verifyPassword(me, current))) {
    return c.json({ error: 'That is not the current password.' }, 403)
  }

  // The session this request arrived on survives. Every other one does not.
  await setPassword(me.id, next, getCookie(c, COOKIE) ?? null)
  log({ evt: 'password_changed', member: me.id, by: 'self' })
  return c.body(null, 204)
}

/** One hour, RS256. Any other HeatSync service verifies it against the JWKS. */
export const token: Handler<Env> = async (c) => {
  const me = c.get('member')
  return c.json({ token: await issueToken(me), expiresIn: 3600 })
}

export const jwks: Handler<Env> = async (c) => c.json(await publicKeys())

/**
 * Liveness, and deliberately not a database check. An API that is up and cannot
 * reach Postgres should stay in the load balancer and answer 503 per request,
 * so the failure reads as a broken database rather than as a missing container.
 */
export const healthz: Handler<Env> = (c) => c.json({ ok: true })

// ----------------------------------------------------------------------------

const MINIMUM = 10

function tooWeak(password: string): string | null {
  if (password.length < MINIMUM) {
    return `A password needs at least ${MINIMUM} characters. Length is what matters; a short phrase beats a short scramble.`
  }
  return password.length > 200 ? 'That password is longer than 200 characters.' : null
}

/**
 * Every other session goes with it. A password is changed because somebody may
 * be in the account, and leaving their sessions alive undoes the change.
 */
async function setPassword(
  memberId: string,
  password: string,
  keep: string | null = null,
): Promise<void> {
  const hashed = await hashPassword(password)
  await sql.begin(async (tx) => {
    await tx`
      update members set password = ${hashed}, reset_token = null, reset_expires = null,
                         updated_at = now()
      where id = ${memberId}`
    await tx`
      delete from sessions
      where member_id = ${memberId} and token is distinct from ${keep}`
  })
}

/** What sign in answers with. The full row is /api/me. */
function self(member: Member): object {
  return { id: member.id, name: member.name, email: member.email, roles: member.roles }
}
