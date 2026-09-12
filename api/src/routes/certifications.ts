import type { Handler } from 'hono'

import { change } from '../audit.ts'
import type { Env } from '../auth.ts'
import { sql } from '../db.ts'
import { bad, body, missing, param, text } from '../http.ts'
import { log } from '../log.ts'

/** The tool list. Ten rows today, and the interlocks ask about these slugs. */
export const list: Handler<Env> = async (c) =>
  c.json(await sql`select slug, name, description from certifications order by name`)

export const grant: Handler<Env> = async (c) => {
  const actor = c.get('member')
  const memberId = param(c, 'id')
  const slug = text((await body(c)).slug, 64)
  if (slug === null) return bad(c, 'Send the slug of the certification to grant.')

  const [member] = await sql`select id from members where id = ${memberId}`
  if (member === undefined) return missing(c, 'That member')
  const [cert] = await sql`select slug from certifications where slug = ${slug}`
  if (cert === undefined) return missing(c, `A certification called ${slug}`)

  await change(
    { actor: actor.id, action: 'cert.grant', target: memberId, detail: { slug } },
    (tx) => tx`
      insert into member_certifications (member_id, cert_slug, granted_by)
      values (${memberId}, ${slug}, ${actor.id})
      on conflict (member_id, cert_slug) do nothing`,
  )

  log({ evt: 'cert_granted', member: memberId, slug, by: actor.id })
  return c.body(null, 204)
}

export const revoke: Handler<Env> = async (c) => {
  const actor = c.get('member')
  const memberId = param(c, 'id')
  const slug = param(c, 'slug')

  const deleted = await change(
    { actor: actor.id, action: 'cert.revoke', target: memberId, detail: { slug } },
    (tx) => tx`
      delete from member_certifications
      where member_id = ${memberId} and cert_slug = ${slug} returning cert_slug`,
  )
  if (deleted.length === 0) return missing(c, 'That certification on that member')

  log({ evt: 'cert_revoked', member: memberId, slug, by: actor.id })
  return c.body(null, 204)
}
