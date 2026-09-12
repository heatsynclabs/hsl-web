import { randomBytes } from 'node:crypto'
import { isIP } from 'node:net'

import { hash as argonHash, hashSync as argonHashSync, verify as argonVerify } from '@node-rs/argon2'
import { compare as bcryptCompare } from 'bcryptjs'
import type { Context, MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'

import { config, RATE_LIMIT, RATE_WINDOW_MS, SESSION_DAYS, SESSION_RENEW_WITHIN_DAYS } from './config.ts'
import { sql } from './db.ts'
import { log } from './log.ts'
import { subjectOf } from './tokens.ts'

export interface Member {
  id: string
  email: string
  name: string
  password: string | null
  roles: string[]
  status: string
  orientedOn: Date | null
  hidden: boolean
  doorAccess: boolean
  memberLevel: number | null
  phone: string | null
  postalCode: string | null
  emergencyName: string | null
  emergencyPhone: string | null
  emergencyEmail: string | null
  currentSkills: string | null
  desiredSkills: string | null
  emailVisible: boolean
  phoneVisible: boolean
  joinedOn: Date
  createdAt: Date
  updatedAt: Date
}

export interface ServiceToken {
  id: string
  name: string
  scopes: string[]
}

export type Env = { Variables: { member: Member; service: ServiceToken } }

export const COOKIE = 'hsl'

// Passwords ------------------------------------------------------------------

/**
 * A failed login against an address nobody holds verifies this instead, so it
 * costs the same time as one against an address somebody does. Otherwise the
 * response time answers "is this person a member" to anyone who asks.
 */
const NO_SUCH_MEMBER = argonHashSync(randomBytes(32).toString('hex'))

export function hashPassword(password: string): Promise<string> {
  return argonHash(password)
}

/**
 * Argon2 throws on a hash it cannot decode, where bcrypt answers false. A row
 * holding a truncated or hand-edited hash would otherwise answer 503 to every
 * sign in that member tried, and to every poll a service token made, which
 * reads as the database being down rather than as one broken row.
 */
async function argonMatches(hash: string, secret: string): Promise<boolean> {
  try {
    return await argonVerify(hash, secret)
  } catch (error) {
    log({ evt: 'hash_unreadable', message: String(error) })
    return false
  }
}

/** The shortest password this system accepts, and the longest. */
const MINIMUM_PASSWORD = 10
const MAXIMUM_PASSWORD = 200

/** Why this password is not one, or null. */
export function tooWeak(password: string): string | null {
  if (password.length < MINIMUM_PASSWORD) {
    return `A password needs at least ${MINIMUM_PASSWORD} characters. Length is what matters; a short phrase beats a short scramble.`
  }
  return password.length > MAXIMUM_PASSWORD
    ? `That password is longer than ${MAXIMUM_PASSWORD} characters.`
    : null
}

/**
 * Argon2id for anything written from now on. The 1,030 bcrypt hashes Devise
 * wrote import verbatim and nobody resets anything: the first successful sign
 * in verifies with bcrypt and replaces the hash in the same breath.
 *
 * Watch this go to zero, then delete the bcrypt branch and the dependency:
 *
 *   select count(*) from members
 *   where password is not null and password not like '$argon2%';
 */
export async function verifyPassword(member: Member | null, password: string): Promise<boolean> {
  const stored = member?.password
  if (stored === undefined || stored === null || stored === '') {
    await argonMatches(NO_SUCH_MEMBER, password)
    return false
  }

  if (stored.startsWith('$argon2')) return argonMatches(stored, password)

  const ok = await bcryptCompare(password + config.pepper, stored)
  if (ok && member !== null) {
    await sql`update members set password = ${await hashPassword(password)}, updated_at = now()
              where id = ${member.id}`
    log({ evt: 'password_upgraded', member: member.id })
  }
  return ok
}

// Sessions -------------------------------------------------------------------

function expiry(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
}

function writeCookie(c: Context, token: string, expires: Date): void {
  setCookie(c, COOKIE, token, {
    domain: config.cookieDomain === '' ? undefined : config.cookieDomain,
    path: '/',
    httpOnly: true,
    secure: config.public,
    sameSite: 'Lax',
    expires,
  })
}

/** Opaque, 32 random bytes, the primary key of sessions. Revoked by deleting a row. */
export async function createSession(c: Context, memberId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  const expires = expiry(SESSION_DAYS)
  const address = clientIp(c)

  await sql`
    insert into sessions (token, member_id, expires_at, user_agent, ip)
    values (${token}, ${memberId}, ${expires}, ${c.req.header('user-agent') ?? null},
            ${address})`

  writeCookie(c, token, expires)
  return token
}

export async function destroySession(c: Context): Promise<void> {
  const token = getCookie(c, COOKIE)
  if (token !== undefined) await sql`delete from sessions where token = ${token}`
  deleteCookie(c, COOKIE, {
    domain: config.cookieDomain === '' ? undefined : config.cookieDomain,
    path: '/',
  })
}

/** Any request inside the last week pushes the session back out to thirty days. */
async function slide(c: Context, token: string, expiresAt: Date): Promise<void> {
  if (expiresAt.getTime() - Date.now() > SESSION_RENEW_WITHIN_DAYS * 24 * 60 * 60 * 1000) return
  const expires = expiry(SESSION_DAYS)
  await sql`update sessions set expires_at = ${expires} where token = ${token}`
  writeCookie(c, token, expires)
}

/** Caddy sets this. An unparseable value is dropped rather than refused: inet is strict. */
function clientIp(c: Context): string | null {
  const forwarded = (c.req.header('x-forwarded-for') ?? '').split(',')[0]?.trim() ?? ''
  return isIP(forwarded) === 0 ? null : forwarded
}

// Who is calling -------------------------------------------------------------

async function byId(id: string): Promise<Member | null> {
  const [row] = await sql<Member[]>`select * from members where id = ${id}`
  return row ?? null
}

export async function byEmail(email: string): Promise<Member | null> {
  const [row] = await sql<Member[]>`select * from members where lower(email) = lower(${email})`
  return row ?? null
}

type Via = 'session' | 'token'

/**
 * A session cookie, or a bearer JWT for anything that is not a browser on the
 * domain. Three dot separated parts is a JWT; the two part form is a service
 * token and is not a member.
 */
async function identify(c: Context): Promise<{ member: Member; via: Via } | null> {
  const cookie = getCookie(c, COOKIE)
  if (cookie !== undefined) {
    const [row] = await sql<Array<Member & { sessionExpires: Date }>>`
      select m.*, s.expires_at as session_expires
      from sessions s join members m on m.id = s.member_id
      where s.token = ${cookie} and s.expires_at > now()`
    if (row !== undefined) {
      await slide(c, cookie, row.sessionExpires)
      return { member: row, via: 'session' }
    }
  }

  const bearer = (c.req.header('authorization') ?? '').replace(/^Bearer /i, '')
  if (bearer.split('.').length !== 3) return null

  const subject = await subjectOf(bearer)
  if (subject === null) return null

  const found = await byId(subject)
  return found === null ? null : { member: found, via: 'token' }
}

function refuse(c: Context, status: 401 | 403 | 429, message: string): Response {
  return c.json({ error: message }, status)
}

const SIGN_IN = 'Sign in first. This needs an account.'
const NOT_ACTIVE = 'This account is not active. An admin can put it back.'

async function asMember(c: Context, only?: Via): Promise<Member | Response> {
  const found = await identify(c)
  if (found === null || (only !== undefined && found.via !== only)) {
    return refuse(c, 401, SIGN_IN)
  }
  if (found.member.status !== 'active') return refuse(c, 403, NOT_ACTIVE)
  c.set('member', found.member)
  return found.member
}

/**
 * A browser cookie specifically, not a JWT.
 *
 * The two routes that carry it are logout and the token exchange. Letting a JWT
 * buy another JWT is a refresh token, and section 2.4 does not have those: the
 * client holds the cookie and asks again.
 */
export const session: MiddlewareHandler<Env> = async (c, next) => {
  const found = await asMember(c, 'session')
  return found instanceof Response ? found : next()
}

/** Valid session or JWT, and status active. */
export const member: MiddlewareHandler<Env> = async (c, next) => {
  const found = await asMember(c)
  return found instanceof Response ? found : next()
}

/** As above, and roles contains this one. */
export function role(name: 'admin' | 'instructor' | 'accountant'): MiddlewareHandler<Env> {
  return async (c, next) => {
    const found = await asMember(c)
    if (found instanceof Response) return found
    if (!found.roles.includes(name) && !found.roles.includes('admin')) {
      return refuse(c, 403, `This needs the ${name} role. Ask an admin.`)
    }
    return next()
  }
}

/** As above, and orientation has happened. Orientation is what opens the directory. */
export const oriented: MiddlewareHandler<Env> = async (c, next) => {
  const found = await asMember(c)
  if (found instanceof Response) return found
  if (found.orientedOn === null) {
    return refuse(c, 403, 'The member directory opens after new member orientation.')
  }
  return next()
}

/** As above, and door_access is true. The whole of the door policy. */
export const doorAccess: MiddlewareHandler<Env> = async (c, next) => {
  const found = await asMember(c)
  if (found instanceof Response) return found
  if (!found.doorAccess) {
    return refuse(c, 403, 'Opening a door from here needs door access. Ask an admin.')
  }
  return next()
}

/**
 * A machine. `Authorization: Bearer <id>.<secret>`, where the id prefix makes
 * the lookup a primary key hit rather than a hash comparison against every row.
 */
export function service(scope: string): MiddlewareHandler<Env> {
  return async (c, next) => {
    const bearer = (c.req.header('authorization') ?? '').replace(/^Bearer /i, '')
    const at = bearer.indexOf('.')
    if (at === -1) return refuse(c, 401, 'This endpoint is for services. Present a service token.')

    const id = bearer.slice(0, at)
    const secret = bearer.slice(at + 1)

    /**
     * Counted before the hash, not after.
     *
     * Verifying an Argon2 hash costs 19 MiB and tens of milliseconds by design,
     * and these endpoints carry no session to rate limit. A token id is a
     * guessable name rather than a secret, so without this anybody who can
     * reach the API can spend the container's whole memory limit on wrong
     * guesses. Only failures count, so a door service polling every five
     * seconds never meets it.
     */
    const attempts = `service:${id}:${clientIp(c) ?? 'unknown'}`
    if (peek(attempts) > RATE_LIMIT) {
      log({ evt: 'rate_limited', service: id })
      return refuse(c, 429, 'Too many attempts against that service token. Wait a quarter of an hour.')
    }

    const [token] = await sql<Array<ServiceToken & { secretHash: string }>>`
      select id, name, scopes, secret_hash from service_tokens
      where id = ${id} and not revoked`

    if (token === undefined || !(await argonMatches(token.secretHash, secret))) {
      bump(attempts)
      return refuse(c, 401, 'That service token is not one this API issued, or it was revoked.')
    }
    if (!token.scopes.includes(scope)) {
      return refuse(c, 403, `Service token ${id} does not hold the ${scope} scope.`)
    }

    // Once a minute at most. A door service polls every five seconds forever,
    // and nobody reads this to the second, so writing a row every time is
    // seventeen thousand writes a day for no reader.
    await sql`
      update service_tokens set last_seen = now()
      where id = ${id} and (last_seen is null or last_seen < now() - interval '1 minute')`
    c.set('service', { id: token.id, name: token.name, scopes: token.scopes })
    return next()
  }
}

// Rate limiting --------------------------------------------------------------

const hits = new Map<string, { count: number; resetAt: number }>()

/**
 * How many keys the counter will hold. Past it the oldest quarter go, which
 * costs those keys their window and keeps a process that cannot be made to
 * allocate without limit.
 */
const MAX_KEYS = 20_000

/** One counter in fifteen minute windows, shared by everything that counts. */
function bump(key: string): number {
  const now = Date.now()
  if (hits.size > 5000) for (const [old, hit] of hits) if (hit.resetAt < now) hits.delete(old)
  if (hits.size > MAX_KEYS) {
    const oldest = [...hits.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt)
    for (const [old] of oldest.slice(0, Math.floor(MAX_KEYS / 4))) hits.delete(old)
  }

  const hit = hits.get(key)
  if (hit === undefined || hit.resetAt < now) {
    hits.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return 1
  }
  hit.count += 1
  return hit.count
}

/** What a key has counted, without counting another one against it. */
function peek(key: string): number {
  const hit = hits.get(key)
  return hit === undefined || hit.resetAt < Date.now() ? 0 : hit.count
}

/**
 * Ten attempts per IP and ten per email per fifteen minutes, counted in memory.
 * One process serving a hackerspace does not need Redis, and losing the counters
 * on a redeploy costs one window.
 */
export function overRateLimit(c: Context, email: string | null): boolean {
  // The address is only counted once the IP is still inside its own limit.
  // Counting it either way lets one caller mint a new key per request by
  // sending a new address each time, which is a map that grows forever.
  if (bump(`ip:${clientIp(c) ?? 'unknown'}`) > RATE_LIMIT) {
    log({ evt: 'rate_limited', by: 'ip' })
    return true
  }
  if (email === null || email === '') return false
  if (bump(`email:${email.toLowerCase()}`) > RATE_LIMIT) {
    log({ evt: 'rate_limited', by: 'email' })
    return true
  }
  return false
}

/** Test seam. Nothing in the running service calls this. */
export function resetRateLimit(): void {
  hits.clear()
}
