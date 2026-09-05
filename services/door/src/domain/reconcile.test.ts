import { CARD_SLOT_COUNT } from '@hsl/schema'
import { describe, expect, it } from 'vitest'

import {
  planIsEmpty,
  planReconcile,
  reportableEvents,
  type CardTableRow,
  type ReconcileInput,
} from './reconcile.ts'

const AT = '2026-09-01T00:00:00.000Z'
const CARD_14: CardTableRow = { slot: 14, cardNumber: '0001E240', permissions: 1 }
const CARD_199: CardTableRow = { slot: 199, cardNumber: '00ABCDEF', permissions: 255 }

/**
 * A healthy database reports a card row for every slot this service owns, so
 * that is the default. A case about an emptied database passes
 * databaseIssuedSlots explicitly.
 */
function plan(input: Partial<ReconcileInput>) {
  const ownedSlots = input.ownedSlots ?? new Set<number>()
  return planReconcile({
    databaseCards: [],
    controllerCards: [],
    databaseIssuedSlots: [...ownedSlots],
    ...input,
    ownedSlots,
  })
}

describe('reconciling the card table', () => {
  it('writes the cards the controller does not have', () => {
    const result = plan({ databaseCards: [CARD_14, CARD_199] })
    expect(result.writes).toEqual([CARD_14, CARD_199])
    expect(result.clears).toEqual([])
  })

  it('writes nothing when the two tables already agree', () => {
    const result = plan({ databaseCards: [CARD_14], controllerCards: [CARD_14] })
    expect(planIsEmpty(result)).toBe(true)
  })

  it('rewrites a slot whose tag or permission mask changed', () => {
    const stale = { slot: 14, cardNumber: '0001E240', permissions: 255 }
    expect(plan({ databaseCards: [CARD_14], controllerCards: [stale] }).writes).toEqual([CARD_14])

    const otherCard = { slot: 14, cardNumber: '00000001', permissions: 1 }
    expect(plan({ databaseCards: [CARD_14], controllerCards: [otherCard] }).writes).toEqual([CARD_14])
  })

  it('does not rewrite a card the controller reports in lower case', () => {
    const lowerCase = { slot: 14, cardNumber: '0001e240', permissions: 1 }
    expect(planIsEmpty(plan({ databaseCards: [CARD_14], controllerCards: [lowerCase] }))).toBe(true)
  })
})

describe('the slot is never renumbered', () => {
  it('writes a card at slot 14 and one at slot 199 to those exact slots', () => {
    const result = plan({ databaseCards: [CARD_199, CARD_14] })
    expect(result.writes.map((card) => card.slot)).toEqual([14, 199])
    expect(result.writes).toEqual([CARD_14, CARD_199])
  })

  it('leaves a gap between slots alone rather than packing the table down', () => {
    const result = plan({ databaseCards: [CARD_14, CARD_199], controllerCards: [CARD_14] })
    expect(result.writes).toEqual([CARD_199])
    expect(result.clears).toEqual([])
  })
})

describe('running it twice', () => {
  it('produces the same plan and no second write', () => {
    const first = plan({ databaseCards: [CARD_14, CARD_199] })
    const afterWriting = first.writes

    const second = plan({ databaseCards: [CARD_14, CARD_199], controllerCards: afterWriting })
    expect(second.writes).toEqual([])
    expect(second.clears).toEqual([])
    expect(planIsEmpty(second)).toBe(true)
  })
})

describe('a card the database does not know about', () => {
  it('is reported and not cleared', () => {
    const result = plan({ controllerCards: [CARD_199] })
    expect(result.unknownControllerCards).toEqual([CARD_199])
    expect(result.clears).toEqual([])
  })

  it('is cleared only once this service has accounted for the slot', () => {
    const result = plan({ controllerCards: [CARD_199], ownedSlots: new Set([199]) })
    expect(result.clears).toEqual([199])
    expect(result.unknownControllerCards).toEqual([])
  })

  it('reaches the API as an event somebody can act on', () => {
    const result = plan({ controllerCards: [CARD_199] })
    const events = reportableEvents(result, '2026-09-01T00:00:00.000Z')
    expect(events).toContainEqual({
      kind: 'card-on-controller-not-in-database',
      at: '2026-09-01T00:00:00.000Z',
      detail: { slot: 199, cardNumber: '00ABCDEF', permissions: 255 },
    })
  })
})

describe('slot 200, which production holds one card at', () => {
  const at200: CardTableRow = { slot: CARD_SLOT_COUNT, cardNumber: '00ABCDEF', permissions: 1 }

  it('is refused rather than written, and the rest of the table still reconciles', () => {
    const result = plan({ databaseCards: [at200, CARD_14] })
    expect(result.writes).toEqual([CARD_14])
    expect(result.refusedCards).toEqual([
      { card: at200, reason: expect.stringContaining('never read by checkUser'), source: 'database' },
    ])
  })

  it('is reported, not cleared, when the controller is the one holding it', () => {
    const result = plan({ controllerCards: [at200], ownedSlots: new Set([CARD_SLOT_COUNT]) })
    expect(result.clears).toEqual([])
    expect(result.refusedCards[0]?.source).toBe('controller')
  })

  it('reaches the API as a refusal naming the slot', () => {
    const events = reportableEvents(plan({ databaseCards: [at200] }), '2026-09-01T00:00:00.000Z')
    expect(events[0]?.kind).toBe('card-slot-refused')
    expect(events[0]?.detail).toMatchObject({ slot: 200, source: 'database' })
  })

  it('refuses a slot past the end of the table without throwing', () => {
    const result = plan({ databaseCards: [{ slot: 4096, cardNumber: '00ABCDEF', permissions: 1 }] })
    expect(result.writes).toEqual([])
    expect(result.refusedCards[0]?.reason).toMatch(/past the end/)
  })
})

describe('two cards claiming one slot', () => {
  it('writes neither and reports both, because the slot is a door permission', () => {
    const other = { slot: 14, cardNumber: '00000009', permissions: 1 }
    const result = plan({ databaseCards: [CARD_14, other] })
    expect(result.writes).toEqual([])
    expect(result.refusedCards.map((refused) => refused.card)).toEqual([CARD_14, other])
  })
})

/**
 * Gate 2 of section 13 of CONTRIBUTING.md: physical cards open the door even
 * when everything in this repository is down. The dangerous case is not this
 * service being down, it is this service being up and confidently wrong.
 *
 * An empty members database is a state a person can reach by accident: `make
 * reset` on the wrong host, a restore that has not finished, DATABASE_URL
 * pointed at a fresh database, or step 13 of the import runbook. The API
 * answers 200 with empty arrays either way, and this service has been running
 * long enough to own every slot, so without a guard the next pass erases the
 * card table off the controller and nobody's fob opens the building.
 */
describe('a members database that claims no cards at all', () => {
  const controllerCards: CardTableRow[] = Array.from({ length: 64 }, (_, index) => ({
    slot: 14 + index,
    cardNumber: (0x1000000 + index).toString(16).toUpperCase().padStart(8, '0'),
    permissions: 1,
  }))
  const ownedSlots = new Set(controllerCards.map((card) => card.slot))

  it('clears nothing, because that is a broken database rather than an empty lab', () => {
    const result = plan({ databaseCards: [], controllerCards, ownedSlots, databaseIssuedSlots: [] })

    expect(result.clears).toEqual([])
    expect(result.writes).toEqual([])
  })

  it('says which slots it kept, so somebody can see it happened', () => {
    const result = plan({ databaseCards: [], controllerCards, ownedSlots, databaseIssuedSlots: [] })

    expect(result.withheldClears).toHaveLength(64)
    expect(result.withheldClears[0]).toBe(14)
  })

  it('reaches the API as an event naming how many cards it refused to erase', () => {
    const events = reportableEvents(plan({ databaseCards: [], controllerCards, ownedSlots, databaseIssuedSlots: [] }), AT)

    expect(events).toContainEqual(
      expect.objectContaining({ kind: 'card-table-clear-withheld', detail: { slots: 64 } }),
    )
  })

  it('still clears one revoked card while the rest of the table stands', () => {
    const result = plan({ databaseCards: controllerCards.slice(1), controllerCards, ownedSlots })

    expect(result.clears).toEqual([14])
    expect(result.withheldClears).toEqual([])
  })

  /**
   * Revoking everybody is a real thing an admin can do, and it is not this
   * guard's business: every card row is still there, so the database is answering.
   */
  it('still clears every card when the lab revokes them all, because the rows remain', () => {
    const result = plan({ databaseCards: [], controllerCards, ownedSlots })

    expect(result.clears).toHaveLength(64)
    expect(result.withheldClears).toEqual([])
  })
})
