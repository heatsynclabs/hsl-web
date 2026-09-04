import { auditLog } from '@hsl/schema'
import { eq, sql } from 'drizzle-orm'
import { testClient } from 'hono/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { Harness, SignedInMember } from './test-support/harness.ts'
import {
  addCard,
  addCertification,
  addMember,
  createHarness,
  describeDatabase,
  ok,
  reportDoorStatus,
} from './test-support/harness.ts'

/**
 * Every privileged route writes exactly one audit row, because the audit log is
 * the whole of the answer to "who changed this", per
 * decisions/0008-single-admin-plus-audit-log.md. One row per change: a route
 * that writes two makes the screen lie about how much happened, and a route
 * that writes none makes a change invisible.
 */
describeDatabase('the audit log', () => {
  const harness: Harness = createHarness()
  const client = testClient(harness.app)

  let admin: SignedInMember
  let instructor: SignedInMember
  let accountant: SignedInMember
  let target: SignedInMember

  beforeAll(async () => {
    await harness.reset()
    admin = await addMember(harness, { admin: true, cardAccess: true })
    instructor = await addMember(harness, { instructor: true })
    accountant = await addMember(harness, { accountant: true })
    target = await addMember(harness)
  })

  beforeEach(async () => {
    await harness.clearActivity()
  })

  afterAll(async () => {
    await harness.close()
  })

  async function auditRows() {
    return harness.db.select().from(auditLog)
  }

  /**
   * The message Postgres refused with. drizzle wraps a failed statement in its
   * own error and puts the database's own message on the cause.
   */
  async function whyRefused(write: Promise<unknown>): Promise<string> {
    try {
      await write
    } catch (error) {
      const cause = error instanceof Error ? error.cause : null
      return cause instanceof Error ? cause.message : String(error)
    }

    throw new Error('The database accepted a write to audit_log that it should have refused.')
  }

  describe('one row per privileged change', () => {
    it('records an admin changing a member', async () => {
      await client.api.members[':id'].$patch(
        { param: { id: target.member.id }, json: { memberLevel: 50, cardAccess: true } },
        { headers: admin.headers },
      )

      const rows = await auditRows()
      expect(rows).toHaveLength(1)
      expect(rows[0]?.action).toBe('member.update')
      expect(rows[0]?.actorId).toBe(admin.member.id)
      expect(rows[0]?.targetId).toBe(target.member.id)
      expect(rows[0]?.detail).toMatchObject({ changed: { memberLevel: 50, cardAccess: true } })
    })

    it('records what a member was before the change', async () => {
      await client.api.members[':id'].$patch(
        { param: { id: target.member.id }, json: { instructor: true } },
        { headers: admin.headers },
      )

      const rows = await auditRows()
      expect(rows[0]?.detail).toMatchObject({ previous: { instructor: false } })

      await client.api.members[':id'].$patch(
        { param: { id: target.member.id }, json: { instructor: false } },
        { headers: admin.headers },
      )
    })

    it('records a card assignment, without the card number', async () => {
      await client.api.cards.$post(
        { json: { userId: target.member.id, cardNumber: '0000ABCD' } },
        { headers: admin.headers },
      )

      const rows = await auditRows()
      expect(rows).toHaveLength(1)
      expect(rows[0]?.action).toBe('card.assign')
      expect(JSON.stringify(rows[0]?.detail)).not.toContain('0000ABCD')
    })

    it('records a card being deactivated', async () => {
      await addCard(harness, target.member.id, 14, '0000000E')

      await client.api.cards[':id'].$patch(
        { param: { id: '14' }, json: { active: false } },
        { headers: admin.headers },
      )

      const rows = await auditRows()
      expect(rows).toHaveLength(1)
      expect(rows[0]?.action).toBe('card.update')
    })

    /**
     * A reassignment moves a card that has been opening the building for
     * somebody. The audit log is what stands in for a second admin approving
     * it, so it has to say who lost the card as well as who gained it.
     */
    it('names the member a reassigned card was taken from', async () => {
      await addCard(harness, target.member.id, 14, '0000000E')

      await client.api.cards[':id'].$patch(
        { param: { id: '14' }, json: { userId: instructor.member.id } },
        { headers: admin.headers },
      )

      const rows = await auditRows()
      expect(rows).toHaveLength(1)
      expect(rows[0]?.targetId).toBe(instructor.member.id)
      expect(rows[0]?.detail).toMatchObject({ previousUserId: target.member.id })
    })

    it('records a certification grant and a revoke separately', async () => {
      await addCertification(harness)

      await client.api.members[':id'].certifications.$post(
        { param: { id: target.member.id }, json: { slug: 'laser' } },
        { headers: instructor.headers },
      )
      expect(await auditRows()).toHaveLength(1)

      await client.api.members[':id'].certifications[':slug'].$delete(
        { param: { id: target.member.id, slug: 'laser' } },
        { headers: instructor.headers },
      )

      const rows = await auditRows()
      expect(rows).toHaveLength(2)
      expect(rows.map((row) => row.action)).toStrictEqual([
        'certification.grant',
        'certification.revoke',
      ])
    })

    it('records a payment', async () => {
      await client.api.payments.$post(
        { json: { userId: target.member.id, amountCents: 5000, paidOn: '2026-08-01' } },
        { headers: accountant.headers },
      )

      const rows = await auditRows()
      expect(rows).toHaveLength(1)
      expect(rows[0]?.action).toBe('payment.record')
      expect(rows[0]?.actorId).toBe(accountant.member.id)
    })

    it('records a door command', async () => {
      await reportDoorStatus(harness)

      await client.api.door.control.$post(
        { json: { command: 'open-front' } },
        { headers: admin.headers },
      )

      const rows = await auditRows()
      expect(rows).toHaveLength(1)
      expect(rows[0]?.action).toBe('door.control')
      expect(rows[0]?.detail).toStrictEqual({ command: 'open-front' })
    })

    it('records a refused door command', async () => {
      await reportDoorStatus(harness)

      await client.api.door.control.$post(
        { json: { command: 'unlock-rear' } },
        { headers: admin.headers },
      )

      const rows = await auditRows()
      expect(rows).toHaveLength(1)
      expect(rows[0]?.action).toBe('door.control.refused')
    })
  })

  describe('what does not belong in it', () => {
    it('writes nothing when a member reads their own record', async () => {
      await client.api.me.$get({}, { headers: target.headers })
      expect(await auditRows()).toHaveLength(0)
    })

    it('writes nothing when a member edits their own contact details', async () => {
      await client.api.me.$patch({ json: { phone: '555 0100' } }, { headers: target.headers })
      expect(await auditRows()).toHaveLength(0)
    })

    it('writes nothing when an admin reads the audit log', async () => {
      await client.api.audit.$get({ query: {} }, { headers: admin.headers })
      expect(await auditRows()).toHaveLength(0)
    })

    it('writes nothing when a change is refused', async () => {
      await client.api.cards.$post(
        { json: { userId: target.member.id, cardNumber: '0000ABCD' } },
        { headers: target.headers },
      )
      expect(await auditRows()).toHaveLength(0)
    })
  })

  describe('reading it back', () => {
    it('gives an admin the newest entry first, with the actor named', async () => {
      await client.api.payments.$post(
        { json: { userId: target.member.id, amountCents: 2500, paidOn: '2026-07-01' } },
        { headers: accountant.headers },
      )
      await client.api.payments.$post(
        { json: { userId: target.member.id, amountCents: 5000, paidOn: '2026-08-01' } },
        { headers: accountant.headers },
      )

      const response = await client.api.audit.$get({ query: {} }, { headers: admin.headers })
      const body = ok(await response.json())

      expect(body.entries).toHaveLength(2)
      expect(body.entries[0]?.detail).toMatchObject({ amountCents: 5000 })
      expect(body.entries[0]?.actorName).toBe(accountant.member.name)
    })

    it('pages backwards by id', async () => {
      for (const amountCents of [1000, 2000, 3000]) {
        await client.api.payments.$post(
          { json: { userId: target.member.id, amountCents, paidOn: '2026-08-01' } },
          { headers: accountant.headers },
        )
      }

      const first = ok(
        await (
          await client.api.audit.$get({ query: { limit: '2' } }, { headers: admin.headers })
        ).json(),
      )
      expect(first.entries).toHaveLength(2)
      expect(first.nextBefore).not.toBeNull()

      const second = ok(
        await (
          await client.api.audit.$get(
            { query: { limit: '2', before: String(first.nextBefore) } },
            { headers: admin.headers },
          )
        ).json(),
      )
      expect(second.entries).toHaveLength(1)
      expect(second.nextBefore).toBeNull()
    })
  })

  /** decisions/0008 requires this to hold in the database, not in the application. */
  describe('append only', () => {
    it('refuses an update to a row that is already written', async () => {
      await client.api.payments.$post(
        { json: { userId: target.member.id, amountCents: 5000, paidOn: '2026-08-01' } },
        { headers: accountant.headers },
      )
      const rows = await auditRows()
      const id = rows[0]?.id ?? 0

      const refusal = await whyRefused(
        harness.db.update(auditLog).set({ action: 'something else' }).where(eq(auditLog.id, id)),
      )
      expect(refusal).toContain('append only')
    })

    it('refuses a delete', async () => {
      await client.api.payments.$post(
        { json: { userId: target.member.id, amountCents: 5000, paidOn: '2026-08-01' } },
        { headers: accountant.headers },
      )

      const refusal = await whyRefused(harness.db.execute(sql`delete from audit_log`))
      expect(refusal).toContain('append only')
    })
  })
})
