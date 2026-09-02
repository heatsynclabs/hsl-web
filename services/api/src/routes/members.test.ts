import { account, auditLog, user } from '@hsl/schema'
import { eq } from 'drizzle-orm'
import { testClient } from 'hono/testing'
import { afterAll, beforeEach, expect, it } from 'vitest'

import type { Harness, SignedInMember } from '../test-support/harness.ts'
import { addCard, addMember, createHarness, describeDatabase } from '../test-support/harness.ts'

/**
 * Signup is open to the internet and nothing could remove what it created, so
 * an account made by somebody who should not have one was permanent.
 *
 * Removing a member who has a history is a different question, with waivers and
 * payment records behind it, and is deliberately refused here.
 */
describeDatabase('undoing a signup', () => {
  const harness: Harness = createHarness()
  const client = testClient(harness.app)

  let admin: SignedInMember

  beforeEach(async () => {
    await harness.reset()
    admin = await addMember(harness, { admin: true })
  })

  afterAll(async () => {
    await harness.close()
  })

  const remove = async (memberId: string, who: SignedInMember) =>
    await client.api.members[':id'].$delete({ param: { id: memberId } }, { headers: who.headers })

  it('removes an account that was created and never used', async () => {
    const stranger = await addMember(harness)

    expect((await remove(stranger.member.id, admin)).status).toBe(204)

    const left = await harness.db.select().from(user).where(eq(user.id, stranger.member.id))
    expect(left).toEqual([])
  })

  it('takes the credential with it, so the address can sign up again', async () => {
    const stranger = await addMember(harness)
    await remove(stranger.member.id, admin)

    const credentials = await harness.db
      .select()
      .from(account)
      .where(eq(account.userId, stranger.member.id))
    expect(credentials).toEqual([])
  })

  it('keeps a member who holds a card', async () => {
    const holder = await addMember(harness)
    await addCard(harness, holder.member.id, 14)

    const response = await remove(holder.member.id, admin)

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('a card') })
  })

  it('keeps a member who has been oriented', async () => {
    const oriented = await addMember(harness, { orientation: new Date() })

    expect((await remove(oriented.member.id, admin)).status).toBe(409)
  })

  it('keeps a member who holds a role', async () => {
    const instructor = await addMember(harness, { instructor: true })

    expect((await remove(instructor.member.id, admin)).status).toBe(409)
  })

  it('leaves a record of the removal that outlives the row', async () => {
    const stranger = await addMember(harness)
    const removedId = stranger.member.id
    await remove(removedId, admin)

    const rows = await harness.db.select().from(auditLog).where(eq(auditLog.action, 'member.remove'))
    expect(rows).toEqual([
      expect.objectContaining({
        targetId: removedId,
        detail: expect.objectContaining({ email: stranger.member.email }),
      }),
    ])
  })

  it('refuses a member who is not an admin', async () => {
    const stranger = await addMember(harness)
    const ordinary = await addMember(harness)

    expect((await remove(stranger.member.id, ordinary)).status).toBe(403)
  })
})
