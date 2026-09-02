import { cards, CARD_SLOT_COUNT, LAST_USABLE_CARD_SLOT } from '@hsl/schema'
import { eq } from 'drizzle-orm'
import { testClient } from 'hono/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { Harness, SignedInMember } from '../test-support/harness.ts'
import {
  addCard,
  addMember,
  createHarness,
  describeDatabase,
  ok,
} from '../test-support/harness.ts'
import { lowestFreeSlot } from './cards.ts'

/**
 * A card slot is an EEPROM address on the door controller. Slot n lives at byte
 * 24 + n * 5, the reader scans 0 through 199, and a renumbered slot silently
 * hands a member someone else's door permission.
 */

describe('picking a slot', () => {
  it('takes the lowest one nobody holds', () => {
    expect(lowestFreeSlot([0, 1, 3])).toBe(2)
  })

  it('starts at zero when the table is empty', () => {
    expect(lowestFreeSlot([])).toBe(0)
  })

  it('skips the slots the legacy import filled', () => {
    const legacy = Array.from({ length: 14 }, (_, index) => index)
    expect(lowestFreeSlot(legacy)).toBe(14)
  })

  it('stops at 199, because checkUser never reads slot 200', () => {
    const everySlot = Array.from({ length: CARD_SLOT_COUNT }, (_, index) => index)
    expect(everySlot).toHaveLength(200)
    expect(lowestFreeSlot(everySlot)).toBeNull()
  })

  it('does not offer slot 200 even when it is the only one free', () => {
    const allButTwoHundred = Array.from({ length: CARD_SLOT_COUNT }, (_, index) => index)
    expect(lowestFreeSlot(allButTwoHundred)).not.toBe(CARD_SLOT_COUNT)
  })
})

describeDatabase('assigning a card', () => {
  const harness: Harness = createHarness()
  const client = testClient(harness.app)

  let admin: SignedInMember
  let target: SignedInMember

  beforeAll(async () => {
    await harness.reset()
    admin = await addMember(harness, { admin: true })
    target = await addMember(harness)
  })

  beforeEach(async () => {
    await harness.clearActivity()
  })

  afterAll(async () => {
    await harness.close()
  })

  it('puts the first card in slot 0', async () => {
    const response = await client.api.cards.$post(
      { json: { userId: target.member.id, cardNumber: '0000ABCD' } },
      { headers: admin.headers },
    )

    expect(response.status).toBe(201)
    const body = ok(await response.json())
    expect(body.card.slot).toBe(0)
  })

  it('fills the lowest gap rather than counting on from the end', async () => {
    await addCard(harness, target.member.id, 0, '00000000')
    await addCard(harness, target.member.id, 1, '00000001')
    await addCard(harness, target.member.id, 3, '00000003')

    const response = await client.api.cards.$post(
      { json: { userId: target.member.id, cardNumber: '0000ABCD' } },
      { headers: admin.headers },
    )

    const body = ok(await response.json())
    expect(body.card.slot).toBe(2)
  })

  it('refuses when every slot the reader can scan is taken', async () => {
    const rows = Array.from({ length: CARD_SLOT_COUNT }, (_, slot) => ({
      id: slot,
      cardNumber: slot.toString(16).toUpperCase().padStart(8, '0'),
      userId: target.member.id,
    }))
    await harness.db.insert(cards).values(rows)

    const response = await client.api.cards.$post(
      { json: { userId: target.member.id, cardNumber: '0000ABCD' } },
      { headers: admin.headers },
    )

    expect(response.status).toBe(409)
    const body = await response.json()
    expect('error' in body ? body.error : '').toContain(String(LAST_USABLE_CARD_SLOT))

    const written = await harness.db.select().from(cards).where(eq(cards.cardNumber, '0000ABCD'))
    expect(written).toHaveLength(0)
  })

  it('refuses a card number that is already in a slot', async () => {
    await addCard(harness, target.member.id, 5, '0000ABCD')

    const response = await client.api.cards.$post(
      { json: { userId: target.member.id, cardNumber: '0000ABCD' } },
      { headers: admin.headers },
    )

    expect(response.status).toBe(409)
  })

  it('refuses a card number that is not eight hex characters', async () => {
    const response = await harness.app.request('/api/cards', {
      method: 'POST',
      headers: { ...admin.headers, 'content-type': 'application/json' },
      body: JSON.stringify({ userId: target.member.id, cardNumber: 'ABCD' }),
    })

    expect(response.status).toBe(400)
  })

  it('keeps the slot when a card moves to another member', async () => {
    await addCard(harness, target.member.id, 14, '0000000E')
    const newHolder = await addMember(harness)

    const response = await client.api.cards[':id'].$patch(
      { param: { id: '14' }, json: { userId: newHolder.member.id } },
      { headers: admin.headers },
    )

    expect(response.status).toBe(200)
    const body = ok(await response.json())
    expect(body.card.slot).toBe(14)
    expect(body.card.userId).toBe(newHolder.member.id)
  })

  it('leaves a legacy card sitting in slot 200 alone', async () => {
    await addCard(harness, target.member.id, CARD_SLOT_COUNT, '0000C8C8')

    const response = await client.api.cards[':id'].$patch(
      { param: { id: '200' }, json: { label: 'the one at 200' } },
      { headers: admin.headers },
    )

    expect(response.status).toBe(200)
    const rows = await harness.db.select().from(cards).where(eq(cards.id, CARD_SLOT_COUNT))
    expect(rows[0]?.id).toBe(200)
  })
})
