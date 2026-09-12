import { randomBytes, randomUUID } from 'node:crypto'

import type { Handler } from 'hono'

import { change } from '../audit.ts'
import { byEmail, hashPassword, type Env, type Member } from '../auth.ts'
import { sql } from '../db.ts'
import { TEXT_LIMIT, bad, body, missing, param, text } from '../http.ts'
import { log } from '../log.ts'
import { sendResetLink } from '../mail.ts'

const ROLES = ['admin', 'instructor', 'accountant']
const STATUSES = ['active', 'lapsed', 'suspended']

/** What a member may change about themselves. Everything else is ignored. */
const OWN_FIELDS = [
  'name',
  'phone',
  'emergencyName',
  'emergencyPhone',
  'currentSkills',
  'desiredSkills',
  'hidden',
] as const

/**
 * What an admin may change about anybody. The legacy system let a member set
 * accountant, member_level, waiver, orientation and hidden on themselves
 * through attr_accessible. That is not reproduced.
 */
const ADMIN_FIELDS = [...OWN_FIELDS, 'email', 'roles', 'status', 'memberLevel', 'oriented', 'doorAccess'] as const

// Views ----------------------------------------------------------------------

/** The directory. No phone, no emergency contact, no level, no status. */
function directoryView(m: Member): object {
  return {
    id: m.id,
    name: m.name,
    email: m.email,
    currentSkills: m.currentSkills,
    desiredSkills: m.desiredSkills,
    joinedOn: m.joinedOn,
  }
}

/** Everything but the credential columns, which never leave this process. */
export function fullView(m: Member): object {
  return {
    id: m.id,
    name: m.name,
    email: m.email,
    roles: m.roles,
    status: m.status,
    oriented: m.oriented,
    hidden: m.hidden,
    doorAccess: m.doorAccess,
    memberLevel: m.memberLevel,
    phone: m.phone,
    emergencyName: m.emergencyName,
    emergencyPhone: m.emergencyPhone,
    currentSkills: m.currentSkills,
    desiredSkills: m.desiredSkills,
    joinedOn: m.joinedOn,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  }
}

// Self -----------------------------------------------------------------------

export const me: Handler<Env> = async (c) => {
  const m = c.get('member')
  const [cards, certifications, payments] = await Promise.all([
    sql`select id, token, label, active, issued_on from credentials
        where member_id = ${m.id} order by issued_on desc`,
    sql`select c.slug, c.name, mc.granted_at from member_certifications mc
        join certifications c on c.slug = mc.cert_slug
        where mc.member_id = ${m.id} order by c.name`,
    sql`select id, amount, paid_on, method, note from payments
        where member_id = ${m.id} order by paid_on desc limit 12`,
  ])

  return c.json({ ...fullView(m), cards, certifications, payments })
}

export const updateMe: Handler<Env> = async (c) => {
  const m = c.get('member')
  const patch = readPatch(await body(c), OWN_FIELDS)
  if (patch instanceof Error) return bad(c, patch.message)
  if (Object.keys(patch).length === 0) return c.json(fullView(m))

  const [updated] = await sql<Member[]>`
    update members set ${sql(patch)}, updated_at = now() where id = ${m.id} returning *`
  return c.json(fullView(updated as Member))
}

// Members --------------------------------------------------------------------

export const signup: Handler<Env> = async (c) => {
  const form = await body(c)
  const name = text(form.name, 200)
  const email = text(form.email, 320)
  const password = typeof form.password === 'string' ? form.password : ''
  const level = readLevel(form.memberLevel)

  if (name === null || email === null) return bad(c, 'Send a name and an email address.')
  if (!email.includes('@')) return bad(c, 'That does not look like an email address.')
  if (password.length < 10) return bad(c, 'A password needs at least 10 characters.')
  if (level instanceof Error) return bad(c, level.message)
  if (form.waiverSigned !== true) {
    return bad(c, 'The waiver has to be signed before an account exists.')
  }
  if ((await byEmail(email)) !== null) {
    return c.json({ error: 'There is already an account on that email. Try a password reset.' }, 409)
  }

  const id = randomUUID()
  const hashed = await hashPassword(password)
  const document = text(form.waiverDocument, TEXT_LIMIT)

  await change({ actor: id, action: 'member.signup', target: id, detail: { memberLevel: level } }, async (tx) => {
    await tx`
      insert into members (id, email, name, password, member_level)
      values (${id}, ${email}, ${name}, ${hashed}, ${level})`
    await tx`
      insert into waivers (member_id, signed_at, document)
      values (${id}, now(), ${document})`
  })

  log({ evt: 'member_created', member: id, by: 'signup' })
  return c.json({ id, name, email }, 201)
}

export const directory: Handler<Env> = async (c) => {
  const q = text(c.req.query('q'), 100)
  const rows = await sql<Member[]>`
    select * from members
    where not hidden and status = 'active'
      ${q === null ? sql`` : sql`and (name ilike ${`%${q}%`} or email ilike ${`%${q}%`})`}
    order by name limit 500`
  return c.json(rows.map(directoryView))
}

export const show: Handler<Env> = async (c) => {
  const found = await byId(param(c, 'id'))
  if (found === null) return missing(c, 'That member')

  const [cards, certifications, waivers] = await Promise.all([
    sql`select id, token, label, active, issued_on from credentials where member_id = ${found.id}`,
    sql`select cert_slug, granted_by, granted_at from member_certifications where member_id = ${found.id}`,
    sql`select id, signed_at, document from waivers where member_id = ${found.id} order by signed_at desc`,
  ])

  return c.json({ ...fullView(found), cards, certifications, waivers })
}

export const create: Handler<Env> = async (c) => {
  const actor = c.get('member')
  const form = await body(c)
  const patch = readPatch(form, ADMIN_FIELDS)
  if (patch instanceof Error) return bad(c, patch.message)

  const name = text(form.name, 200)
  const email = text(form.email, 320)
  if (name === null || email === null) return bad(c, 'Send a name and an email address.')
  if ((await byEmail(email)) !== null) {
    return c.json({ error: 'There is already an account on that email.' }, 409)
  }

  const id = randomUUID()
  await change(
    { actor: actor.id, action: 'member.create', target: id, detail: { email, roles: (patch.roles ?? []) as string[] } },
    (tx) => tx`insert into members ${sql({ ...patch, id })}`,
  )

  log({ evt: 'member_created', member: id, by: actor.id })
  const created = await byId(id)
  return c.json(fullView(created as Member), 201)
}

export const update: Handler<Env> = async (c) => {
  const actor = c.get('member')
  const id = param(c, 'id')
  if ((await byId(id)) === null) return missing(c, 'That member')

  const patch = readPatch(await body(c), ADMIN_FIELDS)
  if (patch instanceof Error) return bad(c, patch.message)
  if (Object.keys(patch).length === 0) return bad(c, 'Nothing in that body is a field this route sets.')

  const updated = (await change(
    { actor: actor.id, action: 'member.update', target: id, detail: { fields: Object.keys(patch) } },
    (tx) => tx`update members set ${sql(patch)}, updated_at = now() where id = ${id} returning *`,
  )) as Member[]

  log({ evt: 'member_updated', member: id, by: actor.id, fields: Object.keys(patch) })
  return c.json(fullView(updated[0] as Member))
}

/**
 * Refused for an account with any history. A member who has paid, held a card,
 * signed a waiver or opened a door is a row other rows point at, and deleting
 * them makes the record unreadable. Suspend instead.
 */
export const remove: Handler<Env> = async (c) => {
  const actor = c.get('member')
  const id = param(c, 'id')
  if ((await byId(id)) === null) return missing(c, 'That member')

  const [history] = await sql<Array<{ kind: string }>>`
    select 'a payment' as kind from payments where member_id = ${id}
    union all select 'a card' from credentials where member_id = ${id}
    union all select 'a waiver' from waivers where member_id = ${id}
    union all select 'a certification' from member_certifications where member_id = ${id}
    union all select 'a door event' from door_events where member_id = ${id}
    limit 1`

  if (history !== undefined) {
    return c.json(
      {
        error:
          `That member has ${history.kind} on file, so the account was left alone. ` +
          'Set status to suspended instead, which keeps the record readable.',
      },
      409,
    )
  }

  await change({ actor: actor.id, action: 'member.delete', target: id }, (tx) =>
    tx`delete from members where id = ${id}`,
  )
  return c.body(null, 204)
}

/** A set-password link, for a member who cannot receive the self-service one. */
export const issueReset: Handler<Env> = async (c) => {
  const actor = c.get('member')
  const id = param(c, 'id')
  const found = await byId(id)
  if (found === null) return missing(c, 'That member')

  const token = randomBytes(32).toString('base64url')
  await change({ actor: actor.id, action: 'member.reset', target: id }, (tx) =>
    tx`update members set reset_token = ${token}, reset_expires = now() + interval '60 minutes',
              updated_at = now()
       where id = ${id}`,
  )

  await sendResetLink(found.email, token)
  return c.body(null, 204)
}

// ----------------------------------------------------------------------------

async function byId(id: string): Promise<Member | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const [row] = await sql<Member[]>`select * from members where id = ${id}`
  return row ?? null
}

function readLevel(value: unknown): number | null | Error {
  if (value === undefined || value === null) return null
  const level = Number(value)
  if (!Number.isInteger(level) || level < 0 || level > 10_000) {
    return new Error('A member level is a whole number of dollars.')
  }
  return level
}

/**
 * The fields present in the body that this caller may set, converted and
 * checked. Unknown fields are ignored rather than refused, and never echoed.
 */
function readPatch(
  form: Record<string, unknown>,
  allowed: readonly string[],
): Record<string, unknown> | Error {
  const patch: Record<string, unknown> = {}

  for (const field of allowed) {
    const value = form[field]
    if (value === undefined) continue

    if (field === 'roles') {
      if (!Array.isArray(value) || value.some((r) => !ROLES.includes(String(r)))) {
        return new Error(`Roles are any of ${ROLES.join(', ')}.`)
      }
      patch.roles = value.map(String)
    } else if (field === 'status') {
      if (!STATUSES.includes(String(value))) return new Error(`Status is one of ${STATUSES.join(', ')}.`)
      patch.status = String(value)
    } else if (field === 'memberLevel') {
      const level = readLevel(value)
      if (level instanceof Error) return level
      patch.memberLevel = level
    } else if (field === 'hidden' || field === 'oriented' || field === 'doorAccess') {
      if (typeof value !== 'boolean') return new Error(`${field} is true or false.`)
      patch[field] = value
    } else if (field === 'name' || field === 'email') {
      const given = text(value, 320)
      if (given === null) return new Error(`${field} cannot be empty.`)
      patch[field] = given
    } else {
      // The optional contact fields. An empty string clears one.
      if (typeof value !== 'string') return new Error(`${field} is text.`)
      if (value.length > TEXT_LIMIT) return new Error(`${field} is longer than ${TEXT_LIMIT} characters.`)
      patch[field] = value.trim() === '' ? null : value.trim()
    }
  }

  return patch
}
