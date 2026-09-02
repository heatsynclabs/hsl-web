import { auditLog, doorEvents } from '@hsl/schema'
import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, expect, it } from 'vitest'

import type { Harness } from './test-support/harness.ts'
import { addMember, createHarness, describeDatabase } from './test-support/harness.ts'

/**
 * The audit log is what the lab has instead of two-admin approval, so a row that
 * can be edited or removed is worth nothing. The refusal lives in the database
 * rather than in a route, because a route is not the only thing that can reach a
 * table.
 *
 * The first version of this guard was a FOR EACH ROW trigger on UPDATE and
 * DELETE. TRUNCATE does not fire row triggers, so one statement still emptied
 * the table. Migration 0002 adds the statement-level trigger. These tests exist
 * so that gap cannot reopen quietly.
 */
describeDatabase('the append-only tables', () => {
  const harness: Harness = createHarness()

  beforeEach(async () => {
    await harness.reset()
    const member = await addMember(harness, { admin: true })

    await harness.db.insert(auditLog).values({
      actorId: member.member.id,
      action: 'card_access.on',
      targetId: member.member.id,
    })
    await harness.db.insert(doorEvents).values({ kind: 'card-table-synced', detail: { slots: 38 } })
  })

  afterAll(async () => {
    await harness.close()
  })

  // Drizzle wraps a failed statement in its own Error and keeps the Postgres
  // error, which carries the trigger's message, as the cause.
  const refuses = async (statement: string) => {
    const thrown = await harness.db
      .execute(sql.raw(statement))
      .then(() => null)
      .catch((error: unknown) => error)

    expect(thrown, `${statement} was allowed`).toBeInstanceOf(Error)
    expect(String((thrown as Error).cause ?? thrown)).toMatch(/append only/)
  }

  const rowCounts = async () => ({
    audit: (await harness.db.select().from(auditLog)).length,
    door: (await harness.db.select().from(doorEvents)).length,
  })

  it('refuses to change an audit row', async () => {
    await refuses(`update audit_log set action = 'tampered'`)
    expect(await rowCounts()).toEqual({ audit: 1, door: 1 })
  })

  it('refuses to delete an audit row', async () => {
    await refuses(`delete from audit_log`)
    expect((await rowCounts()).audit).toBe(1)
  })

  it('refuses to truncate the audit log', async () => {
    await refuses(`truncate audit_log`)
    expect((await rowCounts()).audit).toBe(1)
  })

  it('refuses to change, delete or truncate a door event', async () => {
    await refuses(`update door_events set kind = 'tampered'`)
    await refuses(`delete from door_events`)
    await refuses(`truncate door_events`)
    expect((await rowCounts()).door).toBe(1)
  })

  it('still accepts new rows, because append means append', async () => {
    const member = await addMember(harness)
    await harness.db.insert(auditLog).values({ actorId: member.member.id, action: 'cert.add' })

    expect((await rowCounts()).audit).toBe(2)
  })
})
