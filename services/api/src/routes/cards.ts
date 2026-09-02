import type { Card, CardResponse, ErrorResponse } from '@hsl/schema'
import {
  cards,
  LAST_USABLE_CARD_SLOT,
  patchCardRequest,
  postCardRequest,
  storedCardSlot,
  user,
} from '@hsl/schema'
import { eq, sql } from 'drizzle-orm'
import type { Context } from 'hono'
import { Hono } from 'hono'

import { recordAudit } from '../audit.ts'
import type { AppDeps, AppEnv } from '../context.ts'
import type { Database } from '../db.ts'
import { requireAdmin, signedIn } from '../middleware/require.ts'
import { jsonBody } from '../middleware/validate.ts'
import { cardView } from '../views.ts'

/**
 * Cards, addressed by slot. The slot is an EEPROM address on the controller, so
 * it is assigned once and never renumbered: renumbering silently hands a member
 * someone else's door permission.
 *
 * Nothing here writes to the controller. The door service reads the card table
 * from this API and reconciles the device itself.
 */

/**
 * Two admins assigning a card at the same moment would otherwise read the same
 * free slot and one insert would fail on the primary key. The key is arbitrary
 * and means nothing outside this file.
 */
const CARD_SLOT_LOCK_KEY = 1

export async function cardsFor(db: Database, memberId: string): Promise<Card[]> {
  return db.select().from(cards).where(eq(cards.userId, memberId)).orderBy(cards.id)
}

/** The lowest slot the reader can actually scan that no card holds yet. */
export function lowestFreeSlot(taken: number[]): number | null {
  const held = new Set(taken)

  for (let slot = 0; slot <= LAST_USABLE_CARD_SLOT; slot += 1) {
    if (!held.has(slot)) return slot
  }

  return null
}

export function cardRoutes(deps: AppDeps) {
  const routes = new Hono<AppEnv>()

  return routes
    .post('/api/cards', requireAdmin, jsonBody(postCardRequest), async (c) => {
      const request = c.req.valid('json')

      if (!(await memberExists(deps.db, request.userId))) {
        return refuse(c, 404, 'That member does not exist. No card was assigned.')
      }

      const duplicate = await deps.db
        .select({ id: cards.id })
        .from(cards)
        .where(eq(cards.cardNumber, request.cardNumber))
        .limit(1)
      if (duplicate.length > 0) {
        return refuse(c, 409, `Card ${request.cardNumber} is already in slot ${duplicate[0]?.id}.`)
      }

      const assigned = await assignLowestFreeSlot(deps.db, request)
      if (assigned === null) {
        return refuse(
          c,
          409,
          `Every slot from 0 to ${LAST_USABLE_CARD_SLOT} holds a card. No card was assigned. Deactivate and remove a card that is out of service, then try again.`,
        )
      }

      await recordAudit(deps.db, {
        actorId: signedIn(c).id,
        action: 'card.assign',
        targetId: request.userId,
        // The card number opens a door, so the audit screen records the slot and
        // leaves the number to the card list.
        detail: { slot: assigned.id, permissions: assigned.permissions },
      })

      const body: CardResponse = { card: cardView(assigned) }
      return c.json(body, 201)
    })
    .patch('/api/cards/:id', requireAdmin, jsonBody(patchCardRequest), async (c) => {
      const slot = storedCardSlot.safeParse(Number(c.req.param('id')))
      if (!slot.success) return refuse(c, 404, 'That is not a card slot.')

      const request = c.req.valid('json')
      if (Object.keys(request).length === 0) {
        return refuse(c, 400, 'The request asked for no change, so the card was left as it was.')
      }
      if (request.userId !== undefined && !(await memberExists(deps.db, request.userId))) {
        return refuse(c, 404, 'That member does not exist. The card was left as it was.')
      }

      // The slot itself is not in the request schema, so no edit can renumber it.
      const updated = await deps.db
        .update(cards)
        .set(request)
        .where(eq(cards.id, slot.data))
        .returning()
      const card = updated[0]
      if (card === undefined) return refuse(c, 404, `No card is in slot ${slot.data}.`)

      await recordAudit(deps.db, {
        actorId: signedIn(c).id,
        action: 'card.update',
        targetId: card.userId,
        detail: { slot: card.id, ...request },
      })

      const body: CardResponse = { card: cardView(card) }
      return c.json(body)
    })
}

/**
 * Picks the lowest free slot and writes the card in one transaction, so two
 * admins assigning at once cannot both take the same slot.
 */
async function assignLowestFreeSlot(
  db: Database,
  request: { userId: string; cardNumber: string; label?: string; permissions?: number },
): Promise<Card | null> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${CARD_SLOT_LOCK_KEY})`)

    const taken = await tx.select({ id: cards.id }).from(cards)
    const slot = lowestFreeSlot(taken.map((row) => row.id))
    if (slot === null) return null

    const inserted = await tx
      .insert(cards)
      .values({
        id: slot,
        cardNumber: request.cardNumber,
        userId: request.userId,
        label: request.label ?? null,
        permissions: request.permissions,
      })
      .returning()

    return inserted[0] ?? null
  })
}

async function memberExists(db: Database, memberId: string): Promise<boolean> {
  const rows = await db.select({ id: user.id }).from(user).where(eq(user.id, memberId)).limit(1)
  return rows.length > 0
}

function refuse(c: Context<AppEnv>, status: 400 | 404 | 409, message: string) {
  const body: ErrorResponse = { error: message }
  return c.json(body, status)
}
