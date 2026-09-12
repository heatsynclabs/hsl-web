import type { Handler } from 'hono'

import type { Env } from '../auth.ts'
import { sql } from '../db.ts'
import { page } from '../http.ts'

/**
 * Who changed what, newest first.
 *
 * This is the route that stands in for an approval queue. Section 13 of the
 * decision to let one admin act immediately says the audit log is what makes a
 * mistaken grant visible afterwards, and a log nobody can read does not do that.
 *
 * Paging walks backwards by id rather than by offset, because rows are only
 * ever appended and an offset would shift under the reader.
 */
export const list: Handler<Env> = async (c) => {
  const { limit, before } = page(c)

  const rows = await sql`
    select a.id, a.at, a.action, a.target_id, a.detail, a.actor_id,
           m.name as actor_name
    from audit_log a
    -- Left, because a member named here may have been removed since, and the
    -- entry outlives them.
    left join members m on m.id = a.actor_id
    where ${before === null ? sql`true` : sql`a.id < ${before}`}
    order by a.id desc limit ${limit + 1}`

  const items = rows.slice(0, limit) as Array<{ id: number }>
  return c.json({ items, next: rows.length > limit ? (items.at(-1)?.id ?? null) : null })
}
