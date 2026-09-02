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
import type { z } from 'zod'

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

/** Either the card to return, or the status and words to refuse with. */
type CardOutcome = { card: CardResponse } | { status: 400 | 404 | 409; reason: string }

/**
 * Assigns a card to the lowest slot the reader can scan.
 *
 * The slot is an EEPROM address on the controller, so it is chosen once here and
 * never changed afterwards. A duplicate card number is refused before a slot is
 * taken, because two rows holding the same number would make the reconcile diff
 * ambiguous about which slot the device should keep.
 */
async function assignCard(
  deps: AppDeps,
  actorId: string,
  request: z.infer<typeof postCardRequest>,
): Promise<CardOutcome> {
  if (!(await memberExists(deps.db, request.userId))) {
    return { status: 404, reason: 'That member does not exist. No card was assigned.' }
  }

  const duplicate = await deps.db
    .select({ id: cards.id })
    .from(cards)
    .where(eq(cards.cardNumber, request.cardNumber))
    .limit(1)
  if (duplicate.length > 0) {
    return {
      status: 409,
      reason:
        `Card ${request.cardNumber} is already in slot ${duplicate[0]?.id}, so no slot was ` +
        'taken. It is already issued. Find it in the card table to see who holds it, rather ' +
        'than assigning it again.',
    }
  }

  const [holder] = await deps.db
    .select({ cardAccess: user.cardAccess })
    .from(user)
    .where(eq(user.id, request.userId))
    .limit(1)

  const assigned = await assignLowestFreeSlot(deps.db, request)
  if (assigned === null) {
    return {
      status: 409,
      reason: `Every slot from 0 to ${LAST_USABLE_CARD_SLOT} holds a card. No card was assigned. Deactivate and remove a card that is out of service, then try again.`,
    }
  }

  await recordAudit(deps.db, {
    actorId,
    action: 'card.assign',
    targetId: request.userId,
    // The card number opens a door, so the audit screen records the slot and
    // leaves the number to the card list.
    detail: { slot: assigned.id, permissions: assigned.permissions },
  })

  return { card: { card: cardView(assigned), memberHasCardAccess: holder?.cardAccess ?? false } }
}

/** Relabels, deactivates or reassigns a card. Never moves it to another slot. */
async function updateCard(
  deps: AppDeps,
  actorId: string,
  rawSlot: string,
  request: z.infer<typeof patchCardRequest>,
): Promise<CardOutcome> {
  const slot = storedCardSlot.safeParse(Number(rawSlot))
  if (!slot.success) return { status: 404, reason: 'That is not a card slot.' }

  if (Object.keys(request).length === 0) {
    return {
      status: 400,
      reason: 'The request asked for no change, so the card was left as it was.',
    }
  }
  if (request.userId !== undefined && !(await memberExists(deps.db, request.userId))) {
    return { status: 404, reason: 'That member does not exist. The card was left as it was.' }
  }

  // The slot itself is not in the request schema, so no edit can renumber it.
  const updated = await deps.db.update(cards).set(request).where(eq(cards.id, slot.data)).returning()
  const card = updated[0]
  if (card === undefined) return { status: 404, reason: `No card is in slot ${slot.data}.` }

  await recordAudit(deps.db, {
    actorId,
    action: 'card.update',
    targetId: card.userId,
    detail: { slot: card.id, ...request },
  })

  return { card: { card: cardView(card), memberHasCardAccess: await hasCardAccess(deps.db, card.userId) } }
}

export function cardRoutes(deps: AppDeps) {
  const routes = new Hono<AppEnv>()

  return routes
    .post('/api/cards', requireAdmin, jsonBody(postCardRequest), async (c) => {
      const outcome = await assignCard(deps, signedIn(c).id, c.req.valid('json'))
      if ('status' in outcome) return refuse(c, outcome.status, outcome.reason)
      return c.json(outcome.card, 201)
    })
    .patch('/api/cards/:id', requireAdmin, jsonBody(patchCardRequest), async (c) => {
      const outcome = await updateCard(
        deps,
        signedIn(c).id,
        c.req.param('id'),
        c.req.valid('json'),
      )
      if ('status' in outcome) return refuse(c, outcome.status, outcome.reason)
      return c.json(outcome.card)
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

async function hasCardAccess(db: Database, memberId: string): Promise<boolean> {
  const rows = await db
    .select({ cardAccess: user.cardAccess })
    .from(user)
    .where(eq(user.id, memberId))
    .limit(1)
  return rows[0]?.cardAccess ?? false
}

async function memberExists(db: Database, memberId: string): Promise<boolean> {
  const rows = await db.select({ id: user.id }).from(user).where(eq(user.id, memberId)).limit(1)
  return rows.length > 0
}

function refuse(c: Context<AppEnv>, status: 400 | 404 | 409, message: string) {
  const body: ErrorResponse = { error: message }
  return c.json(body, status)
}
