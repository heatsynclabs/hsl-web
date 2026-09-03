import { LAST_USABLE_CARD_SLOT, type DoorLogEntry } from '@hsl/schema'

import type { CardTableRow } from '../domain/reconcile.ts'

/**
 * Holding a card to the reader, in software.
 *
 * The firmware writes a tag into its log as two 16 bit halves, because a 32 bit
 * tag does not fit one entry. domain/reads.ts puts them back together, and this
 * is the same split in the other direction, so a card presented here is one the
 * enrolment screen can pick up. See reads.ts for the firmware line numbers.
 */

/** Open_Access_Control_Ethernet.ino line 266: `const int divisor = 32767;` */
const DIVISOR = 32767

/** The log letter for the low half. reads.ts reads the same three. */
const OUTCOME_KEYS = { granted: 'G', denied: 'D', presented: 'R' } as const

export type PresentOutcome = keyof typeof OUTCOME_KEYS

/**
 * The two entries the firmware would have written, low half first.
 *
 * A tag of 0 is not written, because reads.ts refuses it: the halves of an
 * empty slot are indistinguishable from a card that reads as zero.
 */
export function readEntries(cardNumber: string, outcome: PresentOutcome): DoorLogEntry[] {
  const tag = Number.parseInt(cardNumber, 16)
  if (!Number.isInteger(tag) || tag <= 0) {
    throw new Error(
      `${cardNumber} is not a card number the reader could produce, so nothing was written to ` +
        'the log. A card number is one to eight hex characters and is not zero.',
    )
  }

  const key = OUTCOME_KEYS[outcome]
  return [
    { key, value: String(tag % DIVISOR) },
    { key: key.toLowerCase(), value: String(Math.floor(tag / DIVISOR)) },
  ]
}

/**
 * What the reader would decide about this tag.
 *
 * ASSUMPTION: the board grants on a tag match in a slot it can read, and the
 * permission byte selects which door rather than whether to open at all. The
 * firmware's checkUser compares the full 32 bit tag, which docs/legacy-system.md
 * records, but what it then does with the mask is not recorded anywhere this
 * repository has read.
 * CONFIRM BY: writing a card with permission 0 to the board in the lab and
 * holding it to the reader.
 * BLAST RADIUS: only the simulator. Nothing in services/door reads a permission
 * mask to decide anything, and the real board decides this for itself.
 */
export function outcomeFor(
  cards: ReadonlyMap<number, CardTableRow>,
  cardNumber: string,
): PresentOutcome {
  const tag = cardNumber.trim().toUpperCase().padStart(8, '0')

  for (const [slot, card] of cards) {
    if (slot > LAST_USABLE_CARD_SLOT) continue
    if (card.cardNumber.toUpperCase() === tag) return 'granted'
  }

  return 'denied'
}
