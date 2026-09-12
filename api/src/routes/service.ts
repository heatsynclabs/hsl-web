import { createHash, randomBytes } from 'node:crypto'

import type { Context, Handler } from 'hono'
import type postgres from 'postgres'

import { change } from '../audit.ts'
import { hashPassword, type Env } from '../auth.ts'
import { config, COMMAND_EXPIRY_SECONDS } from '../config.ts'
import { sql } from '../db.ts'
import { bad, body, missing, param, text } from '../http.ts'
import { log } from '../log.ts'

const KINDS = ['entry', 'denied', 'presented', 'alarm', 'fault', 'command']
const STATES = ['locked', 'unlocked', 'unknown']
const CAPABILITIES = ['open', 'lock', 'unlock', 'alarm']
const OUTCOMES = ['done', 'failed', 'refused', 'expired']
const SCOPES = ['door', 'members:read', 'status:read']

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Which controller is calling. The service token says a door service is on the
 * line; this says which one, so two controllers can run side by side through
 * one token type during a switchover.
 */
function controllerId(c: Context): string | null {
  return text(c.req.header('x-controller-id'), 64)
}

function needsController(c: Context): Response {
  return bad(c, 'Send X-Controller-Id naming the controller this request is about.')
}

// The door service's six ------------------------------------------------------

/**
 * The card list, plus each card's placement on this controller.
 *
 * The placement is handed back exactly as the adapter wrote it. Nothing in this
 * file reads inside one.
 */
export const cards: Handler<Env> = async (c) => {
  const controller = controllerId(c)
  if (controller === null) return needsController(c)

  const rows = await cardRows(controller)

  return c.json({
    version: versionOf(rows),
    cards: rows.map((row) => ({
      id: row.id,
      token: row.token,
      doors: config.doors,
      placement: row.placement ?? null,
    })),
  })
}

/** Where the cards ended up. Written by the adapter, opaque here. */
export const placements: Handler<Env> = async (c) => {
  const controller = controllerId(c)
  if (controller === null) return needsController(c)

  const form = await body(c)
  const written = Array.isArray(form.placements) ? form.placements : []
  const removed = Array.isArray(form.removed) ? form.removed.map(String) : []

  await sql.begin(async (tx) => {
    for (const entry of written) {
      const record = entry as { cardId?: unknown; placement?: unknown }
      const cardId = text(record.cardId, 64)
      if (cardId === null || record.placement === undefined) continue
      await tx`
        insert into door_placements (controller_id, credential_id, placement)
        values (${controller}, ${cardId}, ${sql.json(record.placement as postgres.JSONValue)})
        on conflict (controller_id, credential_id)
        do update set placement = excluded.placement, written_at = now()`
    }
    const gone = removed.filter((id) => UUID.test(id))
    if (gone.length > 0) {
      await tx`
        delete from door_placements
        where controller_id = ${controller} and credential_id in ${sql(gone)}`
    }
  })

  return c.json({ written: written.length, removed: removed.length })
}

/**
 * Waiting commands, claimed, plus the card list version.
 *
 * Anything that waited longer than COMMAND_EXPIRY_SECONDS is recorded as having
 * never run before the rest are handed out. A command that unlocks a door two
 * minutes after somebody asked unlocks it with nobody there, and an admin
 * seeing "expired" knows what happened where a silently missing row tells them
 * nothing.
 */
export const commands: Handler<Env> = async (c) => {
  const controller = controllerId(c)
  if (controller === null) return needsController(c)

  const expired = await sql<Array<{ id: string; action: string; door: string | null }>>`
    update door_commands set resolved_at = now(), outcome = 'expired'
    where controller_id = ${controller} and resolved_at is null
      and requested_at < now() - ${`${COMMAND_EXPIRY_SECONDS} seconds`}::interval
    returning id, action, door`

  for (const command of expired) {
    await sql`
      insert into door_events (controller_id, kind, door, detail)
      values (${controller}, 'command', ${command.door},
              ${sql.json({ command: command.action, outcome: 'expired', id: command.id })})`
  }

  const claimed = await sql<Array<{ id: string; action: string; door: string | null }>>`
    update door_commands set claimed_at = now()
    where id in (
      select id from door_commands
      where controller_id = ${controller} and resolved_at is null
      order by requested_at
    )
    returning id, action, door`

  return c.json({ commands: claimed, cardsVersion: versionOf(await cardRows(controller)) })
}

export const commandResult: Handler<Env> = async (c) => {
  const controller = controllerId(c)
  if (controller === null) return needsController(c)

  const id = param(c, 'id')
  const form = await body(c)
  const outcome = text(form.outcome, 16)
  if (outcome === null || !OUTCOMES.includes(outcome)) {
    return bad(c, `An outcome is one of ${OUTCOMES.join(', ')}.`)
  }

  const [resolved] = await sql<Array<{ action: string; door: string | null }>>`
    update door_commands set resolved_at = now(), outcome = ${outcome}
    where id = ${id} and controller_id = ${controller} and resolved_at is null
    returning action, door`
  if (resolved === undefined) return missing(c, 'An unresolved command with that id')

  await sql`
    insert into door_events (controller_id, kind, door, detail)
    values (${controller}, 'command', ${resolved.door},
            ${sql.json({ command: resolved.action, outcome, id, detail: (form.detail ?? null) as postgres.JSONValue })})`

  log({ evt: 'door_command', controller, command: resolved.action, outcome })
  return c.body(null, 204)
}

export const state: Handler<Env> = async (c) => {
  const controller = controllerId(c)
  if (controller === null) return needsController(c)

  const form = await body(c)
  const doors = typeof form.doors === 'object' && form.doors !== null ? form.doors : {}
  const capabilities = (Array.isArray(form.capabilities) ? form.capabilities : [])
    .map(String)
    .filter((capability) => CAPABILITIES.includes(capability))

  const reportedAt = text(form.reportedAt, 40) ?? new Date().toISOString()
  const rows = Object.entries(doors as Record<string, unknown>).filter(([, value]) =>
    STATES.includes(String(value)),
  )
  if (rows.length === 0) return bad(c, `Send doors as names against ${STATES.join(', ')}.`)

  await sql.begin(async (tx) => {
    for (const [door, value] of rows) {
      await tx`
        insert into door_state (controller_id, door, state, capabilities, reported_at)
        values (${controller}, ${door}, ${String(value)}, ${capabilities}, ${reportedAt})
        on conflict (controller_id, door) do update
          set state = excluded.state,
              capabilities = excluded.capabilities,
              reported_at = excluded.reported_at`
    }
  })

  return c.body(null, 204)
}

/**
 * What happened at the building.
 *
 * The card id is matched against credentials here rather than at the door, so
 * an unissued card arrives as a `presented` row with a token and no member, and
 * an admin can hand it to somebody in one click.
 */
export const events: Handler<Env> = async (c) => {
  const controller = controllerId(c)
  if (controller === null) return needsController(c)

  const form = await body(c)
  const incoming = Array.isArray(form.events) ? form.events : []
  let written = 0

  for (const entry of incoming) {
    const event = entry as Record<string, unknown>
    const kind = text(event.kind, 32)
    if (kind === null || !KINDS.includes(kind)) continue

    const token = text(event.token, 64)
    await sql`
      insert into door_events (controller_id, kind, at, token, member_id, door, detail)
      values (
        ${controller}, ${kind}, ${text(event.at, 40) ?? new Date().toISOString()}, ${token},
        ${token === null ? null : sql`(select member_id from credentials where token = ${token})`},
        ${text(event.door, 32)},
        ${event.detail === undefined || event.detail === null ? null : sql.json(event.detail as postgres.JSONValue)}
      )`
    written += 1
    if (kind === 'fault') log({ evt: 'door_fault', controller, detail: event.detail })
  }

  return c.json({ written })
}

// Service tokens --------------------------------------------------------------

export const listTokens: Handler<Env> = async (c) =>
  c.json(await sql`select id, name, scopes, last_seen, revoked from service_tokens order by id`)

/**
 * The secret is shown once, here, and stored as an Argon2 hash. There is no
 * route that reads it back, because there is no row that holds it.
 */
export const createToken: Handler<Env> = async (c) => {
  const actor = c.get('member')
  const form = await body(c)
  const id = text(form.id, 64)
  const name = text(form.name, 200)
  const scopes = (Array.isArray(form.scopes) ? form.scopes : []).map(String)

  if (id === null || name === null) return bad(c, 'Send an id and a name.')
  if (!/^[a-z0-9-]+$/.test(id)) return bad(c, 'An id is lower case letters, digits and dashes.')
  if (scopes.length === 0 || scopes.some((scope) => !SCOPES.includes(scope))) {
    return bad(c, `Scopes are any of ${SCOPES.join(', ')}.`)
  }

  const [existing] = await sql`select id from service_tokens where id = ${id}`
  if (existing !== undefined) return c.json({ error: `There is already a token called ${id}.` }, 409)

  const secret = randomBytes(32).toString('base64url')
  await change(
    { actor: actor.id, action: 'service_token.create', target: id, detail: { scopes } },
    async (tx) => {
      await tx`
        insert into service_tokens (id, name, secret_hash, scopes)
        values (${id}, ${name}, ${await hashPassword(secret)}, ${scopes})`
    },
  )

  return c.json({ id, name, scopes, token: `${id}.${secret}` }, 201)
}

export const revokeToken: Handler<Env> = async (c) => {
  const actor = c.get('member')
  const id = param(c, 'id')

  const revoked = (await change(
    { actor: actor.id, action: 'service_token.revoke', target: id },
    (tx) => tx`update service_tokens set revoked = true where id = ${id} and not revoked returning id`,
  )) as Array<{ id: string }>
  if (revoked.length === 0) return missing(c, 'A live service token with that id')

  return c.body(null, 204)
}

// ----------------------------------------------------------------------------

/**
 * A digest of the card list, used as its version.
 *
 * A counter somebody has to remember to bump is a counter somebody forgets. The
 * placement is deliberately not in it: the adapter writes placements itself and
 * including them would make every pass change the version it just answered.
 */
function versionOf(rows: ReadonlyArray<{ id: string; token: string }>): string {
  const digest = createHash('sha256')
  digest.update(config.doors.join(','))
  for (const row of rows) digest.update(`\n${row.id}:${row.token}`)
  return digest.digest('hex').slice(0, 16)
}

/**
 * The cards this controller should be holding: every active card belonging to an
 * active member with door access, and where that card sits on this controller.
 */
async function cardRows(
  controller: string,
): Promise<Array<{ id: string; token: string; placement: unknown }>> {
  return sql<Array<{ id: string; token: string; placement: unknown }>>`
    select c.id, c.token, p.placement
    from credentials c
    join members m on m.id = c.member_id
    left join door_placements p
      on p.credential_id = c.id and p.controller_id = ${controller}
    where c.active and m.status = 'active' and m.door_access
    order by c.id`
}
