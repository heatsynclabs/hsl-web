import type { Handler } from 'hono'

import { change } from '../audit.ts'
import type { Env } from '../auth.ts'
import { config } from '../config.ts'
import { sql } from '../db.ts'
import { bad, body, page, text } from '../http.ts'
import { log } from '../log.ts'

/** What the API will queue, and the capability the adapter has to have declared. */
const ACTIONS: Record<string, string> = {
  open: 'open',
  lock: 'lock',
  unlock: 'unlock',
  'alarm.arm': 'alarm',
  'alarm.disarm': 'alarm',
}

/**
 * Refused above the adapter, so the refusal holds whatever hardware is
 * underneath. Unlocking the rear door and leaving it unlocked is a lab decision
 * from 2018-02-22 (HYH). Opening it pulses the strike for five seconds with
 * somebody standing there, which that decision does not cover.
 *
 * `unlock:all` is on the list because it is the same thing asked less
 * precisely: an unlock with no door named reaches the controller as "unlock
 * everything", and everything includes the rear door.
 */
const REFUSED = new Set(['unlock:rear', 'unlock:all'])

/**
 * Opening has to name a door. Leaving it out means "all", which is the safe
 * direction for locking and a guess for opening. Unlocking is not here on
 * purpose: an unlock with no door is a request to unlock everything, which is
 * the thing the 2018 decision refuses, so it goes through the refusal below and
 * leaves an audit row rather than reading as a malformed request.
 */
const NEEDS_A_DOOR = new Set(['open'])

interface StateRow {
  controllerId: string
  door: string
  state: string
  capabilities: string[]
  reportedAt: Date
}

/**
 * State per door, how fresh it is, and what the controller can do.
 *
 * An array rather than one object, because section 5.7 runs the old controller
 * and the new one side by side for a week and a single object cannot say that.
 */
export const state: Handler<Env> = async (c) => {
  const rows = await sql<StateRow[]>`
    select controller_id, door, state, capabilities, reported_at
    from door_state order by controller_id, door`

  const controllers = new Map<string, { doors: Record<string, string>; row: StateRow }>()
  for (const row of rows) {
    const found = controllers.get(row.controllerId) ?? { doors: {}, row }
    found.doors[row.door] = row.state
    if (row.reportedAt < found.row.reportedAt) found.row = row
    controllers.set(row.controllerId, found)
  }

  return c.json(
    [...controllers].map(([controllerId, { doors, row }]) => ({
      controllerId,
      doors,
      reportedAt: row.reportedAt,
      stale: isStale(row.reportedAt),
      capabilities: row.capabilities,
    })),
  )
}

export const command: Handler<Env> = async (c) => {
  const me = c.get('member')
  const form = await body(c)
  const action = text(form.action, 32)
  const door = text(form.door, 32)

  if (action === null || ACTIONS[action] === undefined) {
    return bad(c, `An action is one of ${Object.keys(ACTIONS).join(', ')}.`)
  }
  if (door !== null && !config.doors.includes(door)) {
    return bad(c, `This building has doors called ${config.doors.join(' and ')}.`)
  }
  if (door === null && NEEDS_A_DOOR.has(action)) {
    return bad(c, `Say which door to ${action}: ${config.doors.join(' or ')}.`)
  }

  const controller = await controllerFor(text(form.controllerId, 64))
  if (typeof controller === 'string') return c.json({ error: controller }, 503)

  const refusal = refusalFor(controller, action, door)
  if (refusal !== null) {
    await change(
      {
        actor: me.id,
        action: 'door.command.refused',
        target: controller.controllerId,
        detail: { command: action, door, reason: refusal },
      },
      async () => undefined,
    )
    log({ evt: 'door_command', member: me.id, command: action, outcome: 'refused' })
    return c.json({ error: refusal }, 409)
  }

  const queued = (await change(
    {
      actor: me.id,
      action: 'door.command',
      target: controller.controllerId,
      detail: { command: action, door },
    },
    (tx) => tx`
      insert into door_commands (controller_id, action, door, requested_by)
      values (${controller.controllerId}, ${action}, ${door}, ${me.id})
      returning id`,
  )) as Array<{ id: string }>

  log({ evt: 'door_command', member: me.id, command: action, door, outcome: 'queued' })
  return c.json({ id: queued[0]?.id, action, door, status: 'queued' }, 202)
}

/** Everything the door reported. Two years of it, then the nightly job. */
export const events: Handler<Env> = async (c) => {
  const { limit, before } = page(c)
  const rows = await sql`
    select id, at, controller_id, kind, token, member_id, door, detail
    from door_events
    where ${before === null ? sql`true` : sql`id < ${before}`}
    order by id desc limit ${limit + 1}`

  return c.json(paged(rows, limit))
}

/** A member's own entries and denials, and nobody else's. */
export const myEvents: Handler<Env> = async (c) => {
  const me = c.get('member')
  const { limit, before } = page(c)
  const rows = await sql`
    select id, at, controller_id, kind, door from door_events
    where member_id = ${me.id} ${before === null ? sql`` : sql`and id < ${before}`}
    order by id desc limit ${limit + 1}`

  return c.json(paged(rows, limit))
}

// ----------------------------------------------------------------------------

function isStale(reportedAt: Date): boolean {
  return Date.now() - reportedAt.getTime() > config.doorStaleSeconds * 1000
}

function paged(rows: readonly unknown[], limit: number): { items: unknown[]; next: number | null } {
  const items = rows.slice(0, limit) as Array<{ id: number }>
  return { items, next: rows.length > limit ? (items.at(-1)?.id ?? null) : null }
}

/** The controller to send to: the one named, or the only one there is. */
async function controllerFor(named: string | null): Promise<StateRow | string> {
  const rows = await sql<StateRow[]>`
    select distinct on (controller_id) controller_id, door, state, capabilities, reported_at
    from door_state
    ${named === null ? sql`` : sql`where controller_id = ${named}`}
    order by controller_id, reported_at desc`

  const only = rows[0]
  if (only === undefined) {
    return 'No controller has reported to this API, so there is nothing to send a command to.'
  }
  if (rows.length > 1) {
    return `More than one controller is reporting. Name one of ${rows.map((r) => r.controllerId).join(', ')}.`
  }
  if (isStale(only.reportedAt)) {
    return (
      `The ${only.controllerId} controller last reported ` +
      `${Math.round((Date.now() - only.reportedAt.getTime()) / 1000)} seconds ago, so the link to ` +
      'the lab is down. Cards still open the door. Nothing was queued.'
    )
  }
  return only
}

function refusalFor(controller: StateRow, action: string, door: string | null): string | null {
  if (REFUSED.has(`${action}:${door ?? 'all'}`)) {
    const what = door === null ? 'every door at once' : `the ${door} door`
    return (
      `Unlocking ${what} and leaving it unlocked is refused here, by a lab decision from ` +
      '2018-02-22. Name the front door instead.'
    )
  }

  const needed = ACTIONS[action] as string
  if (!controller.capabilities.includes(needed)) {
    return `The ${controller.controllerId} controller cannot ${needed}, so nothing was queued.`
  }
  return null
}
