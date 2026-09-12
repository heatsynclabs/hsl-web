import type { Handler } from 'hono'

import { change } from '../audit.ts'
import type { Env } from '../auth.ts'
import { sql } from '../db.ts'
import { bad, body, missing, text, uuid } from '../http.ts'
import { log } from '../log.ts'

/**
 * Every card, who holds it, and which controllers are holding a placement for
 * it. Whether a placement row exists, never what is in it.
 *
 * A card with no placement after a pass has completed is one the hardware could
 * not accept, and the reason is a fault event on that controller.
 */
export const list: Handler<Env> = async (c) =>
  c.json(
    await sql`
      select c.id, c.token, c.label, c.active, c.issued_on,
             m.id as member_id, m.name as member_name, m.door_access,
             coalesce(
               array_agg(p.controller_id) filter (where p.controller_id is not null),
               '{}'
             ) as placed_on
      from credentials c
      join members m on m.id = c.member_id
      left join door_placements p on p.credential_id = c.id
      group by c.id, m.id
      order by m.name, c.issued_on desc`,
  )

export const issue: Handler<Env> = async (c) => {
  const actor = c.get('member')
  const form = await body(c)
  const token = text(form.token, 64)
  const memberId = uuid(form.memberId)
  const label = text(form.label, 200)

  if (token === null || memberId === null) return bad(c, 'Send a card id and a member id.')

  const [member] = await sql`select id from members where id = ${memberId}`
  if (member === undefined) return missing(c, 'That member')

  const [held] = await sql<Array<{ memberName: string }>>`
    select m.name as member_name from credentials c join members m on m.id = c.member_id
    where c.token = ${token}`
  if (held !== undefined) {
    return c.json({ error: `That card id is already issued to ${held.memberName}.` }, 409)
  }

  const issued = (await change(
    { actor: actor.id, action: 'credential.issue', target: memberId, detail: { token } },
    (tx) => tx`
      insert into credentials (token, member_id, label) values (${token}, ${memberId}, ${label})
      returning id`,
  )) as Array<{ id: string }>

  log({ evt: 'credential_issued', member: memberId, token, by: actor.id })
  return c.json({ id: issued[0]?.id, token, memberId, label }, 201)
}

/**
 * Never hard deleted. The card id is unique across every card this system has
 * ever issued, and door events carry it, so the row stays and `active` goes
 * false.
 *
 * The placement goes in the same transaction. The cascade on door_placements
 * fires on a delete of the credential and this is an update, so nothing else
 * removes it: a revoked card kept a row on every controller forever, and the
 * card list above went on reporting it as sitting on the board after the door
 * service had cleared the slot.
 */
export const revoke: Handler<Env> = async (c) => {
  const actor = c.get('member')
  const id = uuid(c.req.param('id'))
  if (id === null) return missing(c, 'An active card with that id')

  // Looked up first, so a revoke of a card that is already revoked leaves no
  // audit row. The log is the record of what happened, and an entry for
  // something that did not happen is worse than no entry at all.
  const [held] = await sql`select id from credentials where id = ${id} and active`
  if (held === undefined) return missing(c, 'An active card with that id')

  await change({ actor: actor.id, action: 'credential.revoke', target: id }, async (tx) => {
    await tx`update credentials set active = false where id = ${id}`
    await tx`delete from door_placements where credential_id = ${id}`
  })

  log({ evt: 'credential_revoked', credential: id, by: actor.id })
  return c.body(null, 204)
}
