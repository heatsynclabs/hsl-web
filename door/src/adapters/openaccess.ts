import { request } from 'undici'

import {
  fault,
  now,
  type Capability,
  type Card,
  type DoorAdapter,
  type DoorEvent,
  type DoorState,
  type HeldCard,
  type UploadResult,
} from '../adapter.ts'

/**
 * Open_Access_Control_Ethernet, the board the lab owns this year.
 *
 * Every constant below was read out of `Open_Access_Control_Ethernet.ino` on
 * master, commit 60e499c, and the firmware line numbers are in the comments.
 * This is the only file in the repository that knows any of it.
 *
 * The protocol is query strings over plain HTTP with the privileged password in
 * the URL. Every response is 200 and errors arrive as plain strings in the body,
 * so this reads bodies rather than status codes.
 */

// The firmware, read directly ------------------------------------------------

/** NUMUSERS, line 132: (EEPROM_LASTUSER 1024 - EEPROM_FIRSTUSER 24) / 5. */
const SLOT_COUNT = 200

/**
 * The last slot a card actually works in.
 *
 * addUser refuses a slot only when userNum > NUMUSERS, so it writes 200.
 * checkUser scans to byte 1019, which is slot 199, so it never reads 200 back.
 * A card there does not open the door, and on an ATmega328 its five bytes land
 * past the end of a 1024 byte EEPROM, on EEPROM_ALARM and EEPROM_ALARMARMED.
 */
const LAST_USABLE_SLOT = SLOT_COUNT - 1

/** Card#upload_to_door pads with rjust(8, '0') and this pads the same way. */
const TAG_WIDTH = 8

/** The permission byte. Production holds 1 on 63 cards and 255 on one. */
const DOOR_PERMISSION = 1

/** dumpUser's refusal for a slot it cannot print, line 1560. */
const BAD_USER_NUMBER = 'Bad user number!'

/** The substring the board frames an accepted write or clear with, lines 375 to 426. */
const WRITE_ACCEPTED = 'cur'

/**
 * checkUser refuses 0xFFFFFFFF at line 1511 and deleteUser writes 0xFF across
 * the slot at 1483. Both read back as a row and neither is a card.
 */
const EMPTY_TAGS = new Set(['FFFFFFFF', '00000000'])

/** `const int divisor = 32767;`, line 266. See readLog below. */
const LOG_DIVISOR = 32767

/**
 * How long to wait for the board on one request.
 *
 * Longer than the slowest honest answer and shorter than a tick. Arming calls
 * chirpAlarm twenty times at 300 ms, line 517, so six seconds is legitimate.
 * Without a timeout a wedged board holds the loop for undici's default, which
 * is the ordinary failure of a 2013 Arduino on a shared LAN and must not be the
 * one that blinds the service.
 */
const TIMEOUT_MS = 15_000

/**
 * A pass that would clear more than this many cards at once does nothing and
 * says so. The empty-list guard alone does not cover a card list that came back
 * with one row out of sixty-four.
 */
const MAX_CLEARS_PER_PASS = 5

// Placement -------------------------------------------------------------------

/**
 * Where a card sits on this device. Written here, handed back here, and opaque
 * everywhere else.
 */
export interface Placement {
  slot: number
  mask: number
  tag: string
}

function isPlacement(value: unknown): value is Placement {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.slot === 'number' &&
    typeof candidate.mask === 'number' &&
    typeof candidate.tag === 'string'
  )
}

/**
 * The placement the legacy import seeds, from a legacy `cards` row.
 *
 * It lives here rather than with the import script because it is the Arduino's
 * placement shape, and the only code that knows that shape stays on this side
 * of the line even during migration. `cards.id` is the EEPROM slot and cannot
 * be regenerated: renumbering is what breaks door access.
 */
export function placementForLegacyCard(
  slot: number,
  cardNumber: string,
  mask: number,
): Record<string, number | string> {
  // Built as a Placement so the compiler checks the shape, returned as plain
  // JSON so it can go straight into a jsonb parameter without the import
  // script naming any of these keys.
  const placement: Placement = { slot, mask, tag: padTag(cardNumber) }
  return { ...placement }
}

// The wire codec ---------------------------------------------------------------

/**
 * Chains the login onto the command, which is the form the board logs itself
 * out from, line 616. A bare ?e=PASS leaves the whole lab LAN privileged until
 * something logs out or the board reboots, so nothing here sends one.
 */
export function chained(parameter: string, password: string): string {
  return `?${parameter}&e=${password}`
}

export function padSlot(slot: number): string {
  if (!Number.isInteger(slot) || slot < 0 || slot > SLOT_COUNT) {
    throw new Error(
      `Slot ${slot} is not an address in the card table, so nothing was sent. The table runs ` +
        `from 0 to ${SLOT_COUNT}.`,
    )
  }
  return String(slot).padStart(3, '0')
}

export function padTag(cardNumber: string): string {
  const trimmed = cardNumber.trim().toUpperCase()
  if (!/^[0-9A-F]{1,8}$/.test(trimmed)) {
    throw new Error(
      `Card id ${cardNumber} is not one to eight hex characters, so nothing was sent. Card ids ` +
        'reach this controller as eight uppercase hex characters.',
    )
  }
  return trimmed.padStart(TAG_WIDTH, '0')
}

/** Arduino's println writes CRLF, so a body split on \n alone keeps the \r. */
function lines(body: string): string[] {
  return body.split(/\r?\n/)
}

/**
 * dumpUser, lines 1545 to 1551: slot, permission mask, tag, tab separated and
 * none of them padded. The mask comes before the tag.
 */
const CARD_ROW = /^(\d{1,3})\t(\d{1,3})\t([0-9A-Fa-f]{1,8})$/

/**
 * The occupied slots of a ?a dump, and whether the board printed a card table
 * at all.
 *
 * The tag is hex only because `#define DEBUG 2` at line 105. A board built with
 * DEBUG 0 or 1 prints asterisks there and no readback is possible, which is why
 * `readable` is reported separately from an empty table: a board holding
 * nothing and a board that will not say are different, and treating them the
 * same rewrites every card on every pass forever.
 */
export function parseCardTable(body: string): { rows: Placement[]; readable: boolean } {
  const rows: Placement[] = []
  let readable = false

  for (const line of lines(body)) {
    const match = CARD_ROW.exec(line.trimEnd())
    if (match === null) continue
    readable = true

    const [, slot, mask, tag] = match
    const padded = (tag ?? '').toUpperCase().padStart(TAG_WIDTH, '0')
    if (EMPTY_TAGS.has(padded)) continue
    rows.push({ slot: Number(slot), mask: Number(mask), tag: padded })
  }

  return { rows, readable }
}

/**
 * A write or a clear the board carried out.
 *
 * It frames both with a "cur:" line. A slot above 199 answers "Bad user number!"
 * in that position, line 1560, and the body still contains "cur", so the
 * substring on its own reports success for a write that can never open a door.
 */
export function isWriteAccepted(body: string): boolean {
  return body.includes(WRITE_ACCEPTED) && !body.includes(BAD_USER_NUMBER)
}

/**
 * The ?9 status document.
 *
 * Every command chains the login, and the board prints "authok" before running
 * it, line 349. So a chained ?9 answers "authok" and then the payload, and
 * JSON.parse over the whole body throws on the first character. The document is
 * taken from the first brace to the last instead.
 */
export function parseStatus(body: string): Record<string, number> | null {
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end < start) return null
  try {
    return JSON.parse(body.slice(start, end + 1)) as Record<string, number>
  } catch {
    return null
  }
}

/**
 * Card reads out of the ?z log.
 *
 * The board stores its log as 40 pairs of a one character key and a 16 bit
 * signed integer. A tag is 32 bits and does not fit, so addToLog splits it
 * across two consecutive entries as `LongInfo % divisor` and
 * `LongInfo / divisor`, with divisor 32767 at line 266. Putting it back
 * together is high * 32767 + low.
 *
 * This is the only place that number means anything. checkUser compares the
 * full 32 bit tag, so anything that applies the modulo before matching a card
 * matches the wrong card.
 *
 * printLog walks all forty slots whether or not they hold anything, lines 1615
 * to 1625, and an unused slot prints its NUL key followed by ": 0". The log is
 * a ring the board dumps whole, so a pair can straddle the wrap and the entries
 * are read as a loop for that reason. An unpaired half is skipped: half a tag
 * is not a card id and guessing the other half enrols the wrong person.
 */
type Outcome = 'granted' | 'denied' | 'read'

/** G granted, D denied, R read, with the lowercase partner carrying the high half. */
const READ_KEYS: Record<string, Outcome> = { G: 'granted', D: 'denied', R: 'read' }

export function parseLog(body: string): Array<{ tag: string; outcome: Outcome }> {
  const entries: Array<{ key: string; value: number }> = []
  for (const line of lines(body)) {
    const separator = line.indexOf(':')
    if (separator === -1) continue
    const key = line.slice(0, separator).trim()
    if (!/^[A-Za-z]$/.test(key)) continue
    entries.push({ key, value: Number(line.slice(separator + 1).trim()) })
  }

  const reads: Array<{ tag: string; outcome: Outcome }> = []
  for (let index = 0; index < entries.length; index += 1) {
    const low = entries[index]
    const outcome = low === undefined ? undefined : READ_KEYS[low.key]
    if (low === undefined || outcome === undefined) continue

    // The high half is written immediately after the low half, and wraps.
    const high = entries[(index + 1) % entries.length]
    if (high === undefined || high.key !== low.key.toLowerCase()) continue
    if (!Number.isInteger(high.value) || !Number.isInteger(low.value)) continue
    if (high.value < 0 || low.value < 0) continue

    const tag = high.value * LOG_DIVISOR + low.value
    if (tag === 0) continue
    reads.push({ tag: tag.toString(16).toUpperCase().padStart(TAG_WIDTH, '0'), outcome })
  }

  return reads
}

/** Every query carries the controller password. Nothing logs one. */
export function redact(query: string): string {
  return query.replace(/([?&]e=)[^&]*/g, '$1REDACTED')
}

// Slots ------------------------------------------------------------------------

export function slotRefusal(slot: number): string | null {
  if (!Number.isInteger(slot) || slot < 0) return `slot ${slot} is not an EEPROM address`
  if (slot === SLOT_COUNT) {
    return (
      'slot 200 is written by addUser and never read by checkUser, so a card there never opens ' +
      'the door. It was moved to a free slot below 200.'
    )
  }
  if (slot > SLOT_COUNT) return `slot ${slot} is past the end of the card table`
  return null
}

function firstFreeSlot(taken: ReadonlySet<number>): number | null {
  for (let slot = 0; slot <= LAST_USABLE_SLOT; slot += 1) if (!taken.has(slot)) return slot
  return null
}

// The plan ----------------------------------------------------------------------

export interface Plan {
  writes: Array<{ card: Card; placement: Placement }>
  clears: number[]
  faults: DoorEvent[]
  /** Slots the plan would have cleared and did not. */
  withheld: number[]
  /** Credential ids this device cannot hold at all. Reported, never retried. */
  rejected: string[]
  /**
   * Every card the device should be holding once this plan has run, as the pair
   * of what the device stores and what the API calls it. The two differ: the
   * API has no format rule for a card id and this device wants eight uppercase
   * hex characters.
   */
  holding: Array<{ tag: string; token: string }>
}

/**
 * What to write and what to clear so the device holds exactly these cards.
 *
 * Running it against a device it has already reconciled produces an empty plan,
 * which is what makes the loop safe on a timer. A card keeps its slot: the slot
 * is an EEPROM address, and moving one hands a member somebody else's door
 * permission.
 */
export function planUpload(cards: readonly Card[], held: readonly Placement[]): Plan {
  const faults: DoorEvent[] = []
  const rejected: string[] = []
  const taken = new Set(held.map((row) => row.slot))
  const wanted = new Map<number, { card: Card; placement: Placement }>()

  for (const card of cards) {
    // The API stores a card id as text with no format rule, because rule Two
    // says the hardware format belongs here. So this is where a card id that
    // this device cannot hold is met, and it is met one card at a time: an
    // exception out of this loop would stop the pass, and then one unusable
    // card id in the members database would freeze the card table for
    // everybody, forever.
    let tag: string
    try {
      tag = padTag(card.token)
    } catch (error) {
      faults.push(fault(String(error instanceof Error ? error.message : error), { cardId: card.id }))
      rejected.push(card.id)
      continue
    }

    const placement = isPlacement(card.placement) ? card.placement : null
    const refusal = placement === null ? null : slotRefusal(placement.slot)
    if (placement !== null && refusal !== null) {
      faults.push(fault(refusal, { cardId: card.id, slot: placement.slot }))
    }

    const keep = placement !== null && refusal === null && !wanted.has(placement.slot)
    const slot = keep ? (placement as Placement).slot : firstFreeSlot(union(taken, wanted))
    if (slot === null) {
      faults.push(
        fault(`the card table is full, so ${card.token} was not placed`, { cardId: card.id }),
      )
      continue
    }

    wanted.set(slot, { card, placement: { slot, mask: maskFor(card), tag } })
    taken.add(slot)
  }

  const writes: Plan['writes'] = []
  for (const [slot, entry] of wanted) {
    const present = held.find((row) => row.slot === slot)
    if (present === undefined || !same(present, entry.placement)) writes.push(entry)
  }

  const clears = held.filter((row) => !wanted.has(row.slot)).map((row) => row.slot)

  // An empty card list never means clear the building, and a mass clear is
  // refused. A database that has been emptied or half restored is the case
  // these exist for: the API answers 200 with an empty array in every one of
  // them, and a service that is up and confidently wrong is how the door
  // stops working.
  const withhold =
    (cards.length === 0 && clears.length > 0) || clears.length > MAX_CLEARS_PER_PASS
  if (withhold) {
    faults.push(
      fault(
        `a pass would have cleared ${clears.length} cards, which is more than this service will ` +
          'do at once, so nothing was cleared',
        { slots: clears.length, cards: cards.length },
      ),
    )
  }

  return {
    writes: writes.sort((a, b) => a.placement.slot - b.placement.slot),
    clears: withhold ? [] : clears.sort((a, b) => a - b),
    faults,
    withheld: withhold ? clears.sort((a, b) => a - b) : [],
    rejected,
    holding: [...wanted.values()].map((entry) => ({
      tag: entry.placement.tag,
      token: entry.card.token,
    })),
  }
}

function union(taken: ReadonlySet<number>, wanted: ReadonlyMap<number, unknown>): Set<number> {
  return new Set([...taken, ...wanted.keys()])
}

/**
 * The permission byte for a card.
 *
 * The API's contract is per door so a future controller can say more. This one
 * keeps a single byte beside each tag and the legacy system read 1 as door
 * access, so any door at all is 1 and no doors is not written.
 */
function maskFor(card: Card): number {
  return card.doors.length > 0 ? DOOR_PERMISSION : 0
}

/**
 * Tags are compared case insensitively because nobody has dumped the live
 * device to confirm the case it stores. Comparing case sensitively would
 * rewrite every card on every pass if it answers in lower case.
 */
function same(a: Placement, b: Placement): boolean {
  return a.tag.toUpperCase() === b.tag.toUpperCase() && a.mask === b.mask
}

// The adapter -------------------------------------------------------------------

export type Transport = (query: string) => Promise<string>

export interface OpenAccessOptions {
  password: string
  transport: Transport
  /** Controller door 1 and door 2, in that order. Nobody has confirmed which is which. */
  doors: [string, string]
}

export function createOpenAccess(options: OpenAccessOptions): DoorAdapter {
  const send = (parameter: string): Promise<string> =>
    options.transport(chained(parameter, options.password))

  const [door1, door2] = options.doors
  /** What the device stores against what the API calls it. See Plan.holding. */
  const issued = new Map<string, string>()
  let readable: boolean | null = null
  let pending: DoorEvent[] = []

  const doorNumber = (door: string): 1 | 2 => (door === door2 ? 2 : 1)

  async function readTable(): Promise<{ rows: Placement[]; readable: boolean }> {
    const table = parseCardTable(await send('a'))

    if (readable !== table.readable) {
      readable = table.readable
      if (!table.readable) {
        pending.push(
          fault(
            'the controller will not print its card table, so this service is trusting the ' +
              'placements it holds instead. That is a board built with DEBUG below 2, firmware ' +
              'line 105, which prints asterisks where the tag goes.',
          ),
        )
      }
    }

    return table
  }

  return {
    capabilities: (): Capability[] => ['open', 'lock', 'unlock', 'alarm'],

    fetchCards: async (): Promise<HeldCard[]> => {
      const { rows } = await readTable()
      return rows.map((placement) => ({ token: placement.tag, placement, claimed: false }))
    },

    uploadCards: async (cards: Card[]): Promise<UploadResult> => {
      const table = await readTable()

      // A board that will not print its table says nothing about what it holds,
      // so the placements are what this service has to go on. Believing the
      // empty read instead rewrites every card on every pass, forever.
      const held = table.readable
        ? table.rows
        : cards.map((card) => card.placement).filter(isPlacement)

      const plan = planUpload(cards, held)
      const placements: UploadResult['placements'] = []
      const removed: string[] = [...plan.rejected]
      const faults = [...plan.faults, ...pending]
      pending = []

      for (const { card, placement } of plan.writes) {
        const parameter = `m${padSlot(placement.slot)}&p${String(placement.mask).padStart(3, '0')}&t${placement.tag}`
        const body = await send(parameter)
        if (isWriteAccepted(body)) placements.push({ cardId: card.id, placement })
        else {
          removed.push(card.id)
          faults.push(
            fault(`the controller refused ${redact(parameter)} and the card table was not changed`, {
              cardId: card.id,
              said: firstLine(body),
            }),
          )
        }
      }

      for (const slot of plan.clears) {
        const body = await send(`r${padSlot(slot)}`)
        if (!isWriteAccepted(body)) {
          faults.push(fault(`the controller refused to clear slot ${slot}`, { slot, said: firstLine(body) }))
        }
      }

      // What the reader should now recognise. A refused read of anything else
      // is a card being offered for enrolment rather than a card being denied.
      issued.clear()
      for (const card of plan.holding) issued.set(card.tag, card.token)

      return { placements, removed, faults }
    },

    open: async (door: string): Promise<void> => {
      await send(`o${doorNumber(door)}`)
    },

    setLock: async (door: string | 'all', locked: boolean): Promise<void> => {
      const verb = locked ? 'l' : 'u'
      await send(door === 'all' ? verb : `${verb}=${doorNumber(door)}`)
    },

    /** case '2' arms and case '1' disarms, lines 509 to 521. */
    setAlarm: async (armed: boolean): Promise<void> => {
      await send(armed ? '2' : '1')
    },

    state: async (): Promise<Record<string, DoorState>> => {
      const status = parseStatus(await send('9'))
      if (status === null) return { [door1]: 'unknown', [door2]: 'unknown' }

      // DoorLog.show_status reads 0 as unlocked and anything else as locked.
      const read = (key: string): DoorState =>
        typeof status[key] !== 'number' ? 'unknown' : status[key] === 0 ? 'unlocked' : 'locked'

      return { [door1]: read('door_1_locked'), [door2]: read('door_2_locked') }
    },

    /**
     * The log, then the clear. The board's log is a ring buffer that has to be
     * read and then emptied, and a read that is not followed by a clear reports
     * the same entries again on the next pass.
     */
    drainEvents: async (): Promise<DoorEvent[]> => {
      const reads = parseLog(await send('z'))
      if (reads.length > 0) await send('y')

      const at = now()
      const events: DoorEvent[] = pending
      pending = []

      for (const read of reads) {
        // The board has no clock, so the time is when this service read the log
        // rather than when the card was held to the reader.
        //
        // A refused read of a card this service has not written is what holding
        // an unissued card to the reader looks like, and it is the whole of how
        // enrolment works: it arrives at the API as a `presented` row an admin
        // can hand to somebody in one click.
        // Reported as the card id the API issued, so the event lands on the
        // member who holds it. A tag this service did not write has no API
        // form, and arrives as the reader saw it, which is what an admin
        // copies into POST /api/credentials.
        const token = issued.get(read.tag)
        events.push({
          kind: kindOf(read.outcome, token !== undefined),
          at,
          token: token ?? read.tag,
        })
      }

      return events
    },
  }
}

function kindOf(outcome: Outcome, issued: boolean): 'entry' | 'denied' | 'presented' {
  if (outcome === 'granted') return 'entry'
  if (outcome === 'denied') return issued ? 'denied' : 'presented'
  return 'presented'
}

function firstLine(body: string): string {
  return body.split(/\r?\n/)[0]?.trim().slice(0, 120) ?? ''
}

// The socket ---------------------------------------------------------------------

/**
 * Two different failures with two different answers. A timeout means the board
 * took the connection and stopped talking, which is what a wedged Arduino looks
 * like and what a power cycle fixes. Anything else means nothing was listening,
 * which is a wrong address or a board that is off.
 */
export function httpTransport(baseUrl: string, timeoutMs = TIMEOUT_MS): Transport {
  return async (query: string): Promise<string> => {
    const kept = 'Nothing was changed and cards already on the controller still open the door.'
    let answer
    try {
      answer = await request(`${baseUrl}${query}`, {
        method: 'GET',
        headersTimeout: timeoutMs,
        bodyTimeout: timeoutMs,
      })
    } catch (cause) {
      const timedOut = String(cause).includes('Timeout')
      throw new Error(
        timedOut
          ? `The controller took the connection and did not answer ${redact(query)} within ` +
            `${timeoutMs / 1000} seconds. ${kept} It is wedged rather than absent, so power cycle it.`
          : `The controller could not be reached for ${redact(query)}. ${kept} Check that it is ` +
            'powered and on the LAN, and that CONTROLLER_URL names it.',
        { cause },
      )
    }

    if (answer.statusCode !== 200) {
      throw new Error(
        `The controller answered ${answer.statusCode} to ${redact(query)}. Every response from ` +
          'this board is normally 200, so the address in CONTROLLER_URL is probably not the board.',
      )
    }
    return answer.body.text()
  }
}
