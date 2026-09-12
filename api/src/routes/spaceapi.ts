import { readFile } from 'node:fs/promises'

import type { Handler } from 'hono'

import type { Env } from '../auth.ts'
import { config } from '../config.ts'
import { sql } from '../db.ts'

/**
 * The lab website and an ESP8266 status LED both read this URL, and neither is
 * in this repository. The payload and the path cannot change.
 *
 * The document is a file rather than a database row because it is copy, not
 * state. The two keys the legacy SpaceApiController added at request time are
 * added here the same way.
 */
const TEMPLATE = new URL('../../space_api.template.json', import.meta.url)

let template: Promise<Record<string, unknown>> | null = null

function load(): Promise<Record<string, unknown>> {
  template ??= readFile(TEMPLATE, 'utf8').then((raw) => JSON.parse(raw) as Record<string, unknown>)
  return template
}

/** door_1 is the front door and door_2 the rear, matching the o1 and o2 commands. */
const FRONT = 'front'
const REAR = 'rear'

export const spaceApi: Handler<Env> = async (c) => {
  const rows = await sql<Array<{ door: string; state: string; reportedAt: Date }>>`
    select distinct on (door) door, state, reported_at
    from door_state where door in (${FRONT}, ${REAR})
    order by door, reported_at desc`

  const newest = rows.reduce<Date | null>(
    (latest, row) => (latest === null || row.reportedAt > latest ? row.reportedAt : latest),
    null,
  )
  const fresh = newest !== null && Date.now() - newest.getTime() <= config.doorStaleSeconds * 1000
  const unlocked = (door: string): boolean =>
    fresh && rows.some((row) => row.door === door && row.state === 'unlocked')

  const open = unlocked(FRONT) || unlocked(REAR)

  return c.json({
    ...(await load()),
    open,
    status: status(open, unlocked(FRONT), unlocked(REAR)),
    // Not in the legacy document. A reader that wants to know whether this is a
    // reading or a guess can subtract it from now: when the link to the lab is
    // down, open goes false and this stops moving.
    lastchange: newest === null ? 0 : Math.floor(newest.getTime() / 1000),
  })
}

/**
 * SpaceApiController#index, reproduced including its defect.
 *
 * The first branch fires whenever either door is open, so the door1 and door2
 * values below it are unreachable and production only ever emits both or none.
 * It is copied rather than corrected because parity is the requirement: the LED
 * firmware and the website were written against what this actually emits.
 */
function status(open: boolean, front: boolean, rear: boolean): string {
  if (open) return 'doors_open=both'
  if (front) return 'doors_open=door1'
  if (rear) return 'doors_open=door2'
  return 'doors_open=none'
}
