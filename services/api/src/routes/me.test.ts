import { user } from '@hsl/schema'
import { eq } from 'drizzle-orm'
import { testClient } from 'hono/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { Harness, SignedInMember } from '../test-support/harness.ts'
import { addMember, createHarness, describeDatabase, ok } from '../test-support/harness.ts'

/**
 * The member's own record, and what a member may not do to it.
 *
 * The Rails user model whitelisted accountant, member_level, waiver,
 * orientation and hidden through attr_accessible, and the profile edit accepted
 * them, so a member could grant themself all five. That is recorded as a known
 * defect in docs/legacy-system.md. These tests are the proof it is closed.
 *
 * The requests below are sent as raw bodies rather than through the typed
 * client, because the typed client will not compile a field the contract does
 * not allow. That is the first line of the same defence and this is the second.
 */
describeDatabase('the member record', () => {
  const harness: Harness = createHarness()
  const client = testClient(harness.app)

  let member: SignedInMember
  let other: SignedInMember
  let oriented: SignedInMember

  beforeAll(async () => {
    await harness.reset()
    member = await addMember(harness)
    other = await addMember(harness, {
      phone: '555 0111',
      emergencyName: 'Someone Close',
      emergencyPhone: '555 0112',
      emergencyEmail: 'close@example.test',
    })
    oriented = await addMember(harness, { orientation: new Date() })
  })

  beforeEach(async () => {
    await harness.clearActivity()
  })

  afterAll(async () => {
    await harness.close()
  })

  async function patchMe(signedIn: SignedInMember, body: Record<string, unknown>) {
    return harness.app.request('/api/me', {
      method: 'PATCH',
      headers: { ...signedIn.headers, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  async function readMember(id: string) {
    const rows = await harness.db.select().from(user).where(eq(user.id, id)).limit(1)
    const row = rows[0]
    if (row === undefined) throw new Error('The member row is missing.')
    return row
  }

  describe('what a member may change about themself', () => {
    it('accepts the contact fields and gives them back', async () => {
      const response = await client.api.me.$patch(
        { json: { phone: '555 0100', emergencyName: 'A Friend', currentSkills: 'soldering' } },
        { headers: member.headers },
      )

      expect(response.status).toBe(200)
      const body = ok(await response.json())
      expect(body.member.phone).toBe('555 0100')
      expect(body.member.emergencyName).toBe('A Friend')
      expect(body.member.currentSkills).toBe('soldering')
    })

    it('accepts the two visibility flags', async () => {
      const response = await client.api.me.$patch(
        { json: { emailVisible: true, phoneVisible: true } },
        { headers: member.headers },
      )

      expect(response.status).toBe(200)
      const body = ok(await response.json())
      expect(body.member.emailVisible).toBe(true)
      expect(body.member.phoneVisible).toBe(true)
    })
  })

  describe('what a member may not change about themself', () => {
    const forbidden: Array<[string, Record<string, unknown>]> = [
      ['admin', { admin: true }],
      ['instructor', { instructor: true }],
      ['accountant', { accountant: true }],
      ['memberLevel', { memberLevel: 100 }],
      ['waiver', { waiver: '2026-09-01T00:00:00.000Z' }],
      ['orientation', { orientation: '2026-09-01T00:00:00.000Z' }],
      ['cardAccess', { cardAccess: true }],
      ['email', { email: 'somebody-else@example.test' }],
    ]

    for (const [field, body] of forbidden) {
      it(`refuses a member setting their own ${field}`, async () => {
        const before = await readMember(member.member.id)

        const response = await patchMe(member, body)

        expect(response.status).toBe(400)
        expect(await readMember(member.member.id)).toStrictEqual(before)
      })
    }

    it('refuses the whole edit when one field is not allowed', async () => {
      const response = await patchMe(member, { phone: '555 0199', admin: true })

      expect(response.status).toBe(400)
      expect((await readMember(member.member.id)).phone).not.toBe('555 0199')
    })

    /**
     * hidden is the exception, and deliberately so. patchMeRequest in
     * @hsl/schema allows it and the column comment says the member asked to be
     * left out of the directory, so it is the member's own preference rather
     * than a privilege. It is listed with the legacy defect because Rails
     * exposed it alongside four fields that are privileges.
     */
    it('lets a member take themself out of the directory', async () => {
      const response = await client.api.me.$patch(
        { json: { hidden: true } },
        { headers: member.headers },
      )

      expect(response.status).toBe(200)
      expect((await readMember(member.member.id)).hidden).toBe(true)

      await client.api.me.$patch({ json: { hidden: false } }, { headers: member.headers })
    })
  })

  describe('what one member may read about another', () => {
    it('does not put another member\'s phone number in the directory unless they show it', async () => {
      const response = await client.api.members.$get({}, { headers: oriented.headers })
      const body = await response.json()

      const entry = body.members.find((row) => row.id === other.member.id)
      expect(entry?.phone).toBeNull()
      expect(entry?.email).toBeNull()
    })

    it('never puts an emergency contact in the directory at all', async () => {
      const response = await client.api.members.$get({}, { headers: oriented.headers })
      const body = await response.json()

      const entry = body.members.find((row) => row.id === other.member.id)
      expect(entry).toBeDefined()
      expect(JSON.stringify(entry)).not.toContain('Someone Close')
      expect(JSON.stringify(entry)).not.toContain('555 0112')
    })

    it('shows a phone number to other members when that member turned it on', async () => {
      await harness.db
        .update(user)
        .set({ phoneVisible: true })
        .where(eq(user.id, other.member.id))

      const response = await client.api.members.$get({}, { headers: oriented.headers })
      const body = await response.json()

      const entry = body.members.find((row) => row.id === other.member.id)
      expect(entry?.phone).toBe('555 0111')

      await harness.db
        .update(user)
        .set({ phoneVisible: false })
        .where(eq(user.id, other.member.id))
    })

    it('refuses a member the full record of another member', async () => {
      const response = await client.api.members[':id'].$get(
        { param: { id: other.member.id } },
        { headers: oriented.headers },
      )

      expect(response.status).toBe(403)
      expect(JSON.stringify(await response.json())).not.toContain('555 0112')
    })
  })
})
