import { doorEventReport } from '@hsl/schema'
import type { z } from 'zod'

import { slotRefusal } from './slots.ts'

type DoorEventReport = z.infer<typeof doorEventReport>

/** One entry of a card table, either the database's or the controller's. */
export interface CardTableRow {
  slot: number
  cardNumber: string
  permissions: number
}

export type CardSource = 'database' | 'controller'

export interface RefusedCard {
  card: CardTableRow
  reason: string
  source: CardSource
}

export interface ReconcileInput {
  databaseCards: readonly CardTableRow[]
  controllerCards: readonly CardTableRow[]
  /**
   * Slots this service is responsible for: the ones it has written, and the
   * ones it has seen the database claim. It is the only thing that makes a
   * clear safe. A card the controller holds at a slot nobody here has ever
   * accounted for belongs to somebody's decision, not to a diff, so it is
   * reported instead. The set starts empty at boot, which is the safe
   * direction: the first pass after a restart reports rather than clears.
   */
  ownedSlots: ReadonlySet<number>
}

export interface ReconcilePlan {
  writes: CardTableRow[]
  clears: number[]
  /** Held by the controller, unknown to the database. Reported, never cleared. */
  unknownControllerCards: CardTableRow[]
  refusedCards: RefusedCard[]
}

/**
 * The minimal set of writes and clears that makes the controller's card table
 * agree with the database's. A card keeps its slot: the slot is an EEPROM
 * address, and moving one silently hands a member somebody else's door
 * permission.
 *
 * Running this against a controller it has already reconciled produces an empty
 * plan, which is what makes the loop safe to run on a timer.
 */
export function planReconcile(input: ReconcileInput): ReconcilePlan {
  const refusedCards: RefusedCard[] = []
  const wanted = usableBySlot(input.databaseCards, 'database', refusedCards)
  const held = usableBySlot(input.controllerCards, 'controller', refusedCards)

  const writes: CardTableRow[] = []
  for (const [slot, card] of wanted) {
    const present = held.get(slot)
    if (present === undefined || !sameCard(present, card)) writes.push(card)
  }

  const clears: number[] = []
  const unknownControllerCards: CardTableRow[] = []
  for (const [slot, card] of held) {
    if (wanted.has(slot)) continue
    if (input.ownedSlots.has(slot)) clears.push(slot)
    else unknownControllerCards.push(card)
  }

  return {
    writes: bySlotAscending(writes),
    clears: clears.sort((a, b) => a - b),
    unknownControllerCards: bySlotAscending(unknownControllerCards),
    refusedCards,
  }
}

export function planIsEmpty(plan: ReconcilePlan): boolean {
  return plan.writes.length === 0 && plan.clears.length === 0
}

/** What the API is told about a pass, so somebody can decide about the leftovers. */
export function reportableEvents(plan: ReconcilePlan, at: string): DoorEventReport[] {
  const events: DoorEventReport[] = []

  for (const card of plan.unknownControllerCards) {
    events.push({ kind: 'card-on-controller-not-in-database', at, detail: { ...card } })
  }
  for (const refused of plan.refusedCards) {
    events.push({ kind: 'card-slot-refused', at, detail: { ...refused.card, reason: refused.reason, source: refused.source } })
  }
  if (!planIsEmpty(plan)) {
    events.push({
      kind: 'card-table-reconciled',
      at,
      detail: { written: plan.writes.length, cleared: plan.clears.length },
    })
  }

  return events.map((event) => doorEventReport.parse(event))
}

function usableBySlot(
  rows: readonly CardTableRow[],
  source: CardSource,
  refused: RefusedCard[],
): Map<number, CardTableRow> {
  const claims = new Map<number, CardTableRow[]>()
  for (const card of rows) {
    const refusal = slotRefusal(card.slot)
    if (refusal !== null) {
      refused.push({ card, reason: refusal, source })
      continue
    }
    const claimed = claims.get(card.slot) ?? []
    claimed.push(card)
    claims.set(card.slot, claimed)
  }

  const bySlot = new Map<number, CardTableRow>()
  for (const [slot, claimed] of claims) {
    const only = claimed.length === 1 ? claimed[0] : undefined
    if (only !== undefined) {
      bySlot.set(slot, only)
      continue
    }
    const reason = `${claimed.length} cards claim slot ${slot}, so none of them was written`
    for (const card of claimed) refused.push({ card, reason, source })
  }
  return bySlot
}

/**
 * Tags are compared case insensitively because nobody has dumped the live
 * device to confirm the case it stores. Comparing case sensitively would
 * rewrite every card on every pass if it answers in lowercase.
 */
function sameCard(a: CardTableRow, b: CardTableRow): boolean {
  return a.cardNumber.toUpperCase() === b.cardNumber.toUpperCase() && a.permissions === b.permissions
}

function bySlotAscending(cards: CardTableRow[]): CardTableRow[] {
  return [...cards].sort((a, b) => a.slot - b.slot)
}
