import type {
  CardTableEntry,
  CardTableViewResponse,
  DoorEventsResponse,
  UnknownCard,
  UnknownCardsResponse,
} from '@hsl/schema'
import {
  CARD_PRESENTED,
  cardPresentedDetail,
  cards,
  doorEvents,
  LAST_USABLE_CARD_SLOT,
  user,
} from '@hsl/schema'
import { and, desc, eq, gte } from 'drizzle-orm'
import { Hono } from 'hono'

import type { AppDeps, AppEnv } from '../context.ts'
import type { Database } from '../db.ts'
import { lowestFreeSlot } from './cards.ts'
import { isFresh, latestDoorStatus } from './door.ts'
import { requireAdmin } from '../middleware/require.ts'

/**
 * The door, from an admin's side: enrolling a card, seeing what the controller
 * is believed to hold, and reading what the door has done.
 *
 * Enrolling a card used to be five manual steps. Hold the card to the reader,
 * open the door log, find the refused read, work the tag out of two rows by
 * hand, type it into a form, then push the whole card table to the device. The
 * arithmetic now happens in the door service and the card arrives here as a row
 * to click, which is the whole point of this file.
 */

/** How far back the enrolment queue looks. A card held to a reader last month is not being enrolled today. */
const ENROLMENT_WINDOW_HOURS = 24

function windowStart(now: Date): Date {
  return new Date(now.getTime() - ENROLMENT_WINDOW_HOURS * 60 * 60 * 1000)
}

/**
 * Cards seen at a reader in the last day that no card row claims, newest first.
 *
 * A card the database already holds is left out: it is issued, and the read
 * that produced it is ordinary traffic rather than somebody standing at the
 * door waiting to be enrolled.
 */
export async function unknownCardsSeen(db: Database, now: Date): Promise<UnknownCard[]> {
  const rows = await db
    .select({ detail: doorEvents.detail, at: doorEvents.at })
    .from(doorEvents)
    .where(and(eq(doorEvents.kind, CARD_PRESENTED), gte(doorEvents.at, windowStart(now))))
    .orderBy(desc(doorEvents.at))

  const issued = new Set((await db.select({ cardNumber: cards.cardNumber }).from(cards)).map(
    (card) => card.cardNumber,
  ))

  const found = new Map<string, UnknownCard>()

  for (const row of rows) {
    const parsed = cardPresentedDetail.safeParse(row.detail)
    if (!parsed.success) continue

    const { cardNumber, outcome } = parsed.data
    if (issued.has(cardNumber)) continue

    const at = row.at.toISOString()
    const already = found.get(cardNumber)

    if (already === undefined) {
      found.set(cardNumber, { cardNumber, outcome, timesSeen: 1, firstSeen: at, lastSeen: at })
      continue
    }

    // Rows arrive newest first, so every later one is older than what is held.
    already.timesSeen += 1
    already.firstSeen = at
  }

  return [...found.values()]
}

/** What the controller should be holding, slot by slot, with who holds each card. */
export async function cardTableView(db: Database): Promise<CardTableViewResponse> {
  const rows = await db
    .select({
      slot: cards.id,
      cardNumber: cards.cardNumber,
      active: cards.active,
      memberId: user.id,
      memberName: user.name,
      cardAccess: user.cardAccess,
    })
    .from(cards)
    .leftJoin(user, eq(user.id, cards.userId))
    .orderBy(cards.id)

  const slots: CardTableEntry[] = rows.map((row) => ({
    slot: row.slot,
    cardNumber: row.cardNumber,
    memberId: row.memberId,
    memberName: row.memberName,
    active: row.active,
    // The door service writes a card only when it is active and its member has
    // card access. Anything else is a row the next pass will clear.
    reconciled: row.active && row.cardAccess === true,
  }))

  const taken = rows.map((row) => row.slot)

  return {
    slots,
    usedSlots: slots.length,
    freeSlots: LAST_USABLE_CARD_SLOT + 1 - slots.length,
    nextFreeSlot: lowestFreeSlot(taken),
  }
}

export function doorAdminRoutes(deps: AppDeps) {
  const routes = new Hono<AppEnv>()

  return routes
    .get('/api/door/unknown-cards', requireAdmin, async (c) => {
      const now = new Date()
      const latest = await latestDoorStatus(deps.db)

      const body: UnknownCardsResponse = {
        cards: await unknownCardsSeen(deps.db, now),
        // Without a recent report the queue is whatever was last posted, which
        // is not the same as nothing having been held to the reader.
        stale: !isFresh(latest.reportedAt, deps.config.doorStatusStaleSeconds, now),
      }
      return c.json(body)
    })
    .get('/api/door/card-table-view', requireAdmin, async (c) => c.json(await cardTableView(deps.db)))
    .get('/api/door/events', requireAdmin, async (c) => {
      const rows = await deps.db
        .select()
        .from(doorEvents)
        .orderBy(desc(doorEvents.at))
        .limit(50)

      const body: DoorEventsResponse = {
        events: rows.map((row) => ({
          id: Number(row.id),
          kind: row.kind,
          at: row.at.toISOString(),
          detail: (row.detail ?? null) as Record<string, unknown> | null,
        })),
      }
      return c.json(body)
    })
}
