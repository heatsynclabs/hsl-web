import { auditLog } from '@hsl/schema'

import type { Database, Transaction } from './db.ts'

/**
 * The one way a row reaches audit_log. Every privileged route calls this
 * itself, so what gets recorded is decided by the route that knows what
 * happened rather than guessed by a middleware from a path and a status code.
 *
 * The table refuses updates and deletes in the database, per
 * decisions/0008-single-admin-plus-audit-log.md.
 */

export interface AuditEntryToRecord {
  actorId: string | null
  action: string
  targetId: string | null
  detail?: Record<string, unknown>
}

export async function recordAudit(
  db: Database | Transaction,
  entry: AuditEntryToRecord,
): Promise<void> {
  await db.insert(auditLog).values({
    actorId: entry.actorId,
    action: entry.action,
    targetId: entry.targetId,
    detail: entry.detail ?? null,
  })
}
