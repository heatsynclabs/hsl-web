import type { ErrorResponse, Member } from '@hsl/schema'
import type { Context, MiddlewareHandler } from 'hono'

import type { AppEnv } from '../context.ts'

/**
 * The authorization rules, one helper each. Every privileged route names the
 * one it needs, and every one of them has a test per role including anonymous
 * and including the refusal.
 *
 * Grants are additive and independent, the way app/models/ability.rb had them.
 * An admin passes every check except card access: that one is a plain boolean an
 * admin sets on a member, including on themself, and the grant is audited when
 * they do. Reading it strictly keeps remote door control to a list a person can
 * check on one screen.
 */

const NOT_SIGNED_IN: ErrorResponse = {
  error: 'You are not signed in. Nothing was changed. Sign in and try the request again.',
}

function refuse(c: Context<AppEnv>, message: string) {
  const body: ErrorResponse = { error: message }
  return c.json(body, 403)
}

function signedInMember(c: Context<AppEnv>): Member | null {
  return c.get('member')
}

export const requireMember: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (signedInMember(c) === null) return c.json(NOT_SIGNED_IN, 401)
  await next()
}

export const requireOriented: MiddlewareHandler<AppEnv> = async (c, next) => {
  const member = signedInMember(c)
  if (member === null) return c.json(NOT_SIGNED_IN, 401)

  if (member.orientation === null && !member.instructor && !member.admin) {
    return refuse(
      c,
      'The member directory opens after new member orientation. It was not returned. Ask an admin to record your orientation.',
    )
  }

  await next()
}

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const member = signedInMember(c)
  if (member === null) return c.json(NOT_SIGNED_IN, 401)

  if (!member.admin) {
    return refuse(c, 'That needs an admin. Nothing was changed. Ask an admin to make the change.')
  }

  await next()
}

export const requireInstructor: MiddlewareHandler<AppEnv> = async (c, next) => {
  const member = signedInMember(c)
  if (member === null) return c.json(NOT_SIGNED_IN, 401)

  if (!member.instructor && !member.admin) {
    return refuse(
      c,
      'Certifications are granted by an instructor. Nothing was changed. Ask an instructor or an admin.',
    )
  }

  await next()
}

export const requireAccountant: MiddlewareHandler<AppEnv> = async (c, next) => {
  const member = signedInMember(c)
  if (member === null) return c.json(NOT_SIGNED_IN, 401)

  if (!member.accountant && !member.admin) {
    return refuse(
      c,
      'Payments are recorded by an accountant. Nothing was recorded. Ask an accountant or an admin.',
    )
  }

  await next()
}

export const requireCardAccess: MiddlewareHandler<AppEnv> = async (c, next) => {
  const member = signedInMember(c)
  if (member === null) return c.json(NOT_SIGNED_IN, 401)

  if (!member.cardAccess) {
    return refuse(
      c,
      'Remote door control needs card access on your member record. The command was not sent. An admin can grant it.',
    )
  }

  await next()
}

/**
 * The member behind a request that has already passed one of the checks above.
 * A route reaching this with nobody signed in is a wiring mistake, not a
 * refusal, so it throws rather than answering.
 */
export function signedIn(c: Context<AppEnv>): Member {
  const member = c.get('member')
  if (member === null) {
    throw new Error('A route called signedIn() without requireMember in front of it.')
  }
  return member
}
