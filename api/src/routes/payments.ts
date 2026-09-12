import type { Handler } from 'hono'

import { change } from '../audit.ts'
import type { Env } from '../auth.ts'
import { sql } from '../db.ts'
import { bad, body, missing, param, text } from '../http.ts'
import { log } from '../log.ts'

/**
 * No payment integration. Signup records the tier a member chose and the
 * existing offline rails collect the money.
 */
export const forMember: Handler<Env> = async (c) => {
  const id = param(c, 'id')
  const [member] = await sql`select id from members where id = ${id}`
  if (member === undefined) return missing(c, 'That member')

  return c.json(
    await sql`
      select id, amount, paid_on, method, note, recorded_by
      from payments where member_id = ${id} order by paid_on desc`,
  )
}

export const record: Handler<Env> = async (c) => {
  const actor = c.get('member')
  const form = await body(c)
  const memberId = text(form.memberId, 64)
  const amount = readAmount(form.amount)
  const paidOn = readDate(form.paidOn)

  if (memberId === null) return bad(c, 'Send the member this payment is for.')
  if (amount === null) return bad(c, 'An amount is dollars and cents, and is not zero.')
  if (paidOn === null) return bad(c, 'A payment date is YYYY-MM-DD.')

  const [member] = await sql`select id from members where id = ${memberId}`
  if (member === undefined) return missing(c, 'That member')

  const recorded = (await change(
    { actor: actor.id, action: 'payment.record', target: memberId, detail: { amount, paidOn } },
    (tx) => tx`
      insert into payments (member_id, amount, paid_on, method, note, recorded_by)
      values (${memberId}, ${amount}, ${paidOn}, ${text(form.method, 64)},
              ${text(form.note, 500)}, ${actor.id})
      returning id`,
  )) as Array<{ id: string }>

  log({ evt: 'payment_recorded', member: memberId, by: actor.id })
  return c.json({ id: recorded[0]?.id, memberId, amount, paidOn }, 201)
}

// ----------------------------------------------------------------------------

/** Kept as a string all the way to numeric(10,2), so no amount meets a float. */
function readAmount(value: unknown): string | null {
  const raw = typeof value === 'number' ? String(value) : text(value, 20)
  if (raw === null || !/^-?\d{1,8}(\.\d{1,2})?$/.test(raw) || Number(raw) === 0) return null
  return raw
}

function readDate(value: unknown): string | null {
  const raw = text(value, 10)
  return raw !== null && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null
}
