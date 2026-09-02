import type { DoorLogEntry } from '@hsl/schema'

/**
 * Turning the controller's event log into card reads a person can act on.
 *
 * This is the piece that makes enrolling a card bearable. Today an admin holds
 * an unknown card to the reader, opens the door log, finds a rejected read,
 * works the tag number out by hand from two rows, and types it into a form. The
 * arithmetic below is that hand calculation, done once, in one place.
 *
 * The controller stores its log as 40 pairs of a one character key and a 16 bit
 * signed integer (logKeys and logData in Open_Access_Control_Ethernet.ino). A
 * tag is 32 bits and does not fit, so the firmware splits it across two
 * consecutive entries:
 *
 *   addToLog('D', LongInfo % divisor)   // low, uppercase
 *   addToLog('d', LongInfo / divisor)   // high, lowercase
 *
 * with divisor 32767, declared at line 266. Putting it back together is
 * high * 32767 + low. This is the ONLY place that number means anything: the
 * reader itself compares the full 32 bits, so anything that applies the modulo
 * before matching a card matches the wrong card.
 *
 * Wiegand-26 carries 24 bits, so the high half never exceeds 511 and the 16 bit
 * store never overflows. A wider reader would break this, and the firmware
 * before it.
 */

/** Open_Access_Control_Ethernet.ino line 266: `const int divisor = 32767;` */
const DIVISOR = 32767

/** The three outcomes the firmware records a tag for, keyed by its log letter. */
const OUTCOMES = {
  G: 'granted',
  D: 'denied',
  R: 'presented',
} as const

type Outcome = (typeof OUTCOMES)[keyof typeof OUTCOMES]

export interface CardRead {
  /** Eight uppercase hex characters, the form the controller is written in. */
  cardNumber: string
  outcome: Outcome
}

function isLowHalf(key: string): key is keyof typeof OUTCOMES {
  return key in OUTCOMES
}

/** The lowercase partner that carries the high half of the same tag. */
function highHalfKey(lowKey: keyof typeof OUTCOMES): string {
  return lowKey.toLowerCase()
}

function toCardNumber(high: number, low: number): string | null {
  if (!Number.isInteger(high) || !Number.isInteger(low)) return null
  if (high < 0 || low < 0) return null

  const tag = high * DIVISOR + low
  if (tag === 0) return null

  return tag.toString(16).toUpperCase().padStart(8, '0')
}

/**
 * Reads every card the log mentions, newest last.
 *
 * The log is a ring buffer that the firmware dumps whole, so a pair can straddle
 * the wrap. Entries are read as a loop rather than a flat list for that reason.
 * An unpaired half is skipped: half a tag is not a card number and guessing the
 * other half would enroll the wrong person.
 */
export function readCards(entries: readonly DoorLogEntry[]): CardRead[] {
  const reads: CardRead[] = []
  if (entries.length === 0) return reads

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (entry === undefined || !isLowHalf(entry.key)) continue

    // The high half is written immediately after the low half, and wraps with
    // the buffer.
    const partner = entries[(index + 1) % entries.length]
    if (partner === undefined || partner.key !== highHalfKey(entry.key)) continue

    const cardNumber = toCardNumber(Number(partner.value), Number(entry.value))
    if (cardNumber === null) continue

    reads.push({ cardNumber, outcome: OUTCOMES[entry.key] })
  }

  return reads
}

/**
 * The reads worth telling an admin about: a card the database does not know.
 *
 * A denied read is the interesting one, because that is what holding an
 * unissued card to the reader produces. A granted read of an unknown card would
 * mean the controller holds a card the database lost, which is worth seeing for
 * the opposite reason.
 */
export function unknownCards(
  reads: readonly CardRead[],
  known: ReadonlySet<string>,
): CardRead[] {
  const seen = new Set<string>()

  return reads.filter((read) => {
    if (known.has(read.cardNumber) || seen.has(read.cardNumber)) return false
    seen.add(read.cardNumber)
    return true
  })
}
