import type { AuditResponse } from '@hsl/schema'
import { auditLog, auditQuery, user } from '@hsl/schema'
import { desc, eq, lt } from 'drizzle-orm'
import { Hono } from 'hono'

import type { AppDeps, AppEnv } from '../context.ts'
import { requireAdmin } from '../middleware/require.ts'
import { queryParameters } from '../middleware/validate.ts'
import { auditEntryView } from '../views.ts'

/**
 * Who changed what, newest first. This is the screen that replaced the approval
 * queue in decisions/0008-single-admin-plus-audit-log.md, so it is the only
 * thing that makes a mistaken grant visible after the fact.
 *
 * Paging walks backwards by id rather than by offset, because rows are only
 * ever appended and an offset would shift under the reader.
 */
export function auditRoutes(deps: AppDeps) {
  const routes = new Hono<AppEnv>()

  return routes
    .get('/api/audit', requireAdmin, queryParameters(auditQuery), async (c) => {
      const { limit, before } = c.req.valid('query')

      const rows = await deps.db
        .select({ entry: auditLog, actorName: user.name })
        .from(auditLog)
        // Left, because the member who acted may have been removed since.
        .leftJoin(user, eq(user.id, auditLog.actorId))
        .where(before === undefined ? undefined : lt(auditLog.id, before))
        .orderBy(desc(auditLog.id))
        .limit(limit)

      const entries = rows.map((row) => auditEntryView(row.entry, row.actorName))
      const oldest = entries[entries.length - 1]

      const body: AuditResponse = {
        entries,
        nextBefore: entries.length === limit && oldest !== undefined ? oldest.id : null,
      }
      return c.json(body)
    })
}
