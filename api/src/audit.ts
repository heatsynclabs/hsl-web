import type postgres from 'postgres'
import type { TransactionSql } from 'postgres'

import { sql } from './db.ts'

export type Tx = TransactionSql<Record<string, unknown>>

export interface Entry {
  actor: string | null
  action: string
  target?: string
  detail?: Record<string, postgres.JSONValue>
}

/**
 * A privileged write and its audit row, in one transaction.
 *
 * Discipline does not work, so there is no way to express the write without the
 * row: the audit fields are arguments, not a second call a reviewer has to
 * notice is missing. A write that fails rolls its audit row back with it.
 */
export async function change<T>(entry: Entry, write: (tx: Tx) => PromiseLike<T>): Promise<T> {
  const detail = entry.detail ?? null

  // sql.begin's declared return type unwraps an array result, which is right
  // for its own callers and wrong for this one: a write that returns rows
  // returns rows.
  return sql.begin(async (tx) => {
    const result = await write(tx)
    await tx`
      insert into audit_log (actor_id, action, target_id, detail)
      values (${entry.actor}, ${entry.action}, ${entry.target ?? null},
              ${detail === null ? null : sql.json(detail)})`
    return result
  }) as unknown as Promise<T>
}
