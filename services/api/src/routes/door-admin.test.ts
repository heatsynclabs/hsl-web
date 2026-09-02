import { CARD_PRESENTED, doorEvents } from '@hsl/schema'
import { testClient } from 'hono/testing'
import { afterAll, beforeEach, expect, it } from 'vitest'

import type { Harness, SignedInMember } from '../test-support/harness.ts'
import {
  addCard,
  addMember,
  createHarness,
  describeDatabase,
  ok,
  reportDoorStatus,
} from '../test-support/harness.ts'

/**
 * Enrolling a card. In the Rails app this was five manual steps: hold the card
 * to the reader, open the door log, find the refused read, work the tag out of
 * two rows by hand, then create the card and push the whole table.
 *
 * The tag arithmetic now happens in the door service, so what an admin sees is
 * a row to assign. These tests are about the queue that row comes from.
 */
describeDatabase('the card enrolment queue', () => {
  const harness: Harness = createHarness()
  const client = testClient(harness.app)

  let admin: SignedInMember
  let member: SignedInMember

  const present = async (cardNumber: string, outcome = 'denied', at = new Date()) => {
    await harness.db.insert(doorEvents).values({
      kind: CARD_PRESENTED,
      at,
      detail: { cardNumber, outcome },
    })
  }

  const queue = async (who: SignedInMember) =>
    await client.api.door['unknown-cards'].$get({}, { headers: who.headers })

  const queueBody = async (who: SignedInMember) => ok(await (await queue(who)).json())

  beforeEach(async () => {
    await harness.reset()
    admin = await addMember(harness, { admin: true })
    member = await addMember(harness)
    await reportDoorStatus(harness)
  })

  afterAll(async () => {
    await harness.close()
  })

  it('shows a card held to the reader that no card row claims', async () => {
    await present('0000C4D9')

    const body = await queueBody(admin)

    expect(body.cards).toEqual([
      expect.objectContaining({ cardNumber: '0000C4D9', outcome: 'denied', timesSeen: 1 }),
    ])
  })

  it('leaves out a card that is already issued', async () => {
    await addCard(harness, member.member.id, 14, '0000A1B2')
    await present('0000A1B2', 'granted')
    await present('0000C4D9')

    const body = await queueBody(admin)

    expect(body.cards.map((card) => card.cardNumber)).toEqual(['0000C4D9'])
  })

  it('counts a card held to the reader several times as one row', async () => {
    const older = new Date(Date.now() - 60_000)
    await present('0000C4D9', 'denied', older)
    await present('0000C4D9')

    const body = await queueBody(admin)

    expect(body.cards).toHaveLength(1)
    expect(body.cards[0]?.timesSeen).toBe(2)
    expect(new Date(body.cards[0]!.firstSeen).getTime()).toBe(older.getTime())
  })

  it('forgets a card nobody has presented for a day', async () => {
    await present('0000C4D9', 'denied', new Date(Date.now() - 25 * 60 * 60 * 1000))

    expect((await queueBody(admin)).cards).toEqual([])
  })

  it('shows a granted read of a card the database does not hold, which is the opposite problem', async () => {
    await present('0000C4D9', 'granted')

    expect((await queueBody(admin)).cards[0]?.outcome).toBe('granted')
  })

  it('says the queue is stale when the door service has not reported', async () => {
    await harness.clearActivity()
    await present('0000C4D9')

    expect((await queueBody(admin)).stale).toBe(true)
  })

  it('refuses a member who is not an admin', async () => {
    expect((await queue(member)).status).toBe(403)
  })

  it('refuses anonymous', async () => {
    expect((await client.api.door['unknown-cards'].$get()).status).toBe(401)
  })
})

describeDatabase('the card table an admin sees', () => {
  const harness: Harness = createHarness()
  const client = testClient(harness.app)

  let admin: SignedInMember

  const view = async (who: SignedInMember) =>
    await client.api.door['card-table-view'].$get({}, { headers: who.headers })

  const viewBody = async (who: SignedInMember) => ok(await (await view(who)).json())

  beforeEach(async () => {
    await harness.reset()
    admin = await addMember(harness, { admin: true })
  })

  afterAll(async () => {
    await harness.close()
  })

  it('names who holds each slot, and which slot is next', async () => {
    const holder = await addMember(harness, { cardAccess: true })
    await addCard(harness, holder.member.id, 14, '0000A1B2')

    const body = await viewBody(admin)

    expect(body.slots).toEqual([
      expect.objectContaining({ cardNumber: '0000A1B2', memberName: holder.member.name }),
    ])
    expect(body.usedSlots).toBe(1)
    expect(body.nextFreeSlot).toBe(0)
  })

  it('says a card will be cleared when its member lost card access', async () => {
    const revoked = await addMember(harness, { cardAccess: false })
    await addCard(harness, revoked.member.id, 15, '0000C4D9')

    const body = await viewBody(admin)

    expect(body.slots[0]?.reconciled).toBe(false)
  })

  it('counts the free slots against the range the reader can scan', async () => {
    const body = await viewBody(admin)

    // checkUser stops at slot 199, so 0 through 199 is 200 usable slots.
    expect(body.freeSlots).toBe(200)
  })

  it('refuses anonymous', async () => {
    expect((await client.api.door['card-table-view'].$get()).status).toBe(401)
  })
})
