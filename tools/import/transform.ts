import { randomBytes } from 'node:crypto'

/**
 * The value conversions the import performs, kept apart from the database so
 * each one can be tested on its own. Every function here refuses rather than
 * guesses: a bad value stops the import instead of landing in the members
 * database as something plausible.
 */

/** Card#upload_to_door writes card_number.rjust(8, '0') to the controller. */
export const CARD_NUMBER_WIDTH = 8

const HEX = /^[0-9A-Fa-f]+$/

/**
 * Eight uppercase hex characters, which is the width the controller stores and
 * therefore the only form the rest of this system ever sees. A number wider
 * than eight characters is refused rather than truncated, because truncating
 * hands the slot a different card.
 */
export function canonicalCardNumber(raw: string | null): string {
  const trimmed = (raw ?? '').trim()

  if (trimmed === '') throw new Error('card number is empty')
  if (!HEX.test(trimmed)) throw new Error(`card number is not hex: ${trimmed}`)
  if (trimmed.length > CARD_NUMBER_WIDTH) {
    throw new Error(`card number is wider than ${CARD_NUMBER_WIDTH} characters: ${trimmed}`)
  }

  return trimmed.toUpperCase().padStart(CARD_NUMBER_WIDTH, '0')
}

/**
 * legacy payments.amount is `numeric` with no declared precision or scale, read
 * from the production dump on 2026-09-01. It arrives as a string and is
 * converted digit by digit, so no amount passes through a floating point
 * number on its way to an integer count of cents.
 */
interface Decimal {
  negative: boolean
  whole: string
  fraction: string
}

function splitDecimal(amount: string): Decimal {
  const trimmed = amount.trim()
  const negative = trimmed.startsWith('-')
  const [whole = '', fraction = ''] = (negative ? trimmed.slice(1) : trimmed).split('.')

  if (!/^\d+$/.test(whole) || (fraction !== '' && !/^\d+$/.test(fraction))) {
    throw new Error(`payment amount is not a plain decimal: ${amount}`)
  }
  if (fraction.length > 2 && /[^0]/.test(fraction.slice(2))) {
    throw new Error(`payment amount has fractional cents: ${amount}`)
  }

  return { negative, whole, fraction }
}

/**
 * payments.amount_cents is an integer column. The check below is on the
 * magnitude before the sign goes back on, which is right in both directions:
 * int4 reaches one further down than up.
 *
 * Refusing here names the legacy row. Letting it through stops the whole import
 * at the insert with `value "..." is out of range for type integer`, which names
 * no row out of the 8,291 the table holds.
 */
const CENTS_LIMIT = 2_147_483_647

export function amountToCents(amount: string | null): number {
  if (amount === null) return 0

  const { negative, whole, fraction } = splitDecimal(amount)
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2))

  if (cents > CENTS_LIMIT) {
    throw new Error(`payment amount does not fit in the cents column: ${amount}`)
  }

  return negative ? -cents : cents
}

/**
 * User#card_access_enabled in the Rails app: true when the member holds at
 * least one card with card_permissions of exactly 1. The mask is not a flag
 * field there and it is not treated as one here, so the single production card
 * carrying 255 grants its holder nothing.
 */
export const CARD_ACCESS_PERMISSION = 1

export function membersWithCardAccess(
  cards: ReadonlyArray<{ userId: number | null; permissions: number | null }>,
): Set<number> {
  const holders = new Set<number>()

  for (const card of cards) {
    if (card.userId !== null && card.permissions === CARD_ACCESS_PERMISSION) {
      holders.add(card.userId)
    }
  }

  return holders
}

/**
 * The shape better-auth 1.7.2 generates, read from
 * @better-auth/core/src/utils/id.ts: 32 characters of a-z, A-Z and 0-9. An
 * imported member and a member who signs up tomorrow have to be
 * indistinguishable, because nothing downstream knows which is which.
 */
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const ID_LENGTH = 32
// 4 * 62. Bytes at or above it are discarded so every character is equally likely.
const ID_BYTE_CEILING = 248

export function generateMemberId(): string {
  const characters: string[] = []

  while (characters.length < ID_LENGTH) {
    for (const byte of randomBytes(ID_LENGTH)) {
      if (byte >= ID_BYTE_CEILING) continue
      characters.push(ID_ALPHABET[byte % ID_ALPHABET.length] as string)
      if (characters.length === ID_LENGTH) break
    }
  }

  return characters.join('')
}

/**
 * better-auth looks a member up with findUserByEmail(email.toLowerCase()) and
 * compares for equality, so an address stored with any uppercase character can
 * never sign in. All 1,061 production rows are already lowercase; this makes
 * sure they stay that way.
 */
export function canonicalEmail(email: string): string {
  return email.trim().toLowerCase()
}
