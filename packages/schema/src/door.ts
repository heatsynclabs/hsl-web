import { z } from 'zod'

/**
 * The contract between the API and the door service, and the interface every
 * controller adapter implements. Both sides import this file, so the wire shape
 * cannot drift.
 */

// NUMUSERS in Open_Access_Control_Ethernet.ino: (EEPROM_LASTUSER 1024 - EEPROM_FIRSTUSER 24) / 5.
export const CARD_SLOT_COUNT = 200

/**
 * checkUser scans while i <= EEPROM_LASTUSER - 5, so byte offset 1019 is the
 * last one it reads and slot 199 is the last slot the reader can ever match.
 * addUser accepts slot 200, which is why production holds one card there.
 */
export const LAST_USABLE_CARD_SLOT = 199

/** A slot the API may hand out. Slot 200 is writable on the device and unreadable. */
export const assignableCardSlot = z.int().min(0).max(LAST_USABLE_CARD_SLOT)

/** A slot the database may already hold, including the one legacy card at 200. */
export const storedCardSlot = z.int().min(0).max(CARD_SLOT_COUNT)

/**
 * Eight uppercase hex characters. Legacy rows are five, six or seven characters
 * and the Rails uploader padded with rjust(8, '0'), so the import pads once and
 * everything downstream sees the padded form.
 *
 * ASSUMPTION: the controller stores the tag case-insensitively.
 * CONFIRM BY: dumping the live card table with ?a and comparing.
 * BLAST RADIUS: reconcile would rewrite every card once per pass.
 */
export const cardNumber = z.string().regex(/^[0-9A-F]{8}$/)

/** The permission mask byte the controller keeps beside each tag. */
export const cardPermissions = z.int().min(0).max(255)

export const doorName = z.enum(['front', 'rear'])
export type Door = z.infer<typeof doorName>

/**
 * The ?9 payload, with the two door booleans decoded. door_1 is the front door
 * and door_2 the rear, matching the o1 and o2 commands, and 0 means unlocked.
 * armed, activated, alarm_2 and alarm_3 pass through as the numbers the firmware
 * reports because nothing has confirmed what their values mean.
 */
export const doorStatus = z.object({
  frontLocked: z.boolean(),
  rearLocked: z.boolean(),
  armed: z.int(),
  activated: z.int(),
  alarm2: z.int(),
  alarm3: z.int(),
})
export type DoorStatus = z.infer<typeof doorStatus>

/**
 * One "key: value" line of the ?z event log. The legend is G granted, R read,
 * D denied, lowercase likewise. A 32 bit tag arrives split across two entries
 * as value % 32767 and value / 32767, which is the only place that divisor
 * applies. Card matching itself is an exact 32 bit comparison.
 */
export const doorLogEntry = z.object({
  key: z.string(),
  value: z.string(),
})
export type DoorLogEntry = z.infer<typeof doorLogEntry>

/** One row of the card table the door service reconciles the controller to. */
export const syncCard = z.object({
  slot: assignableCardSlot,
  cardNumber,
  permissions: cardPermissions,
})
export type SyncCard = z.infer<typeof syncCard>

export const doorCommand = z.enum([
  'open-front',
  'open-rear',
  'unlock',
  'unlock-front',
  'unlock-rear',
  'lock',
  'lock-front',
  'lock-rear',
  'arm',
  'disarm',
])
export type DoorCommand = z.infer<typeof doorCommand>

/**
 * What the door service fetches from the API. Cards at slot 200 are not in it:
 * the reader never scans that far, and on an ATmega328 those five bytes wrap
 * onto the alarm state at EEPROM offsets 0 and 1.
 */
export const cardTableResponse = z.object({
  generatedAt: z.iso.datetime(),
  cards: z.array(syncCard),
  /**
   * Every slot the members database has a card row for, active or not.
   *
   * This is what makes a clear safe, and it has to come from the database
   * rather than from what the door service remembers writing. It used to be
   * process memory that started empty at boot, so revoking a card and then
   * restarting the service left the card on the controller with nothing that
   * would ever remove it: the row had left the write list, and the slot was no
   * longer owned, so the pass reported it instead of clearing it and the fob
   * went on opening the door.
   *
   * A slot absent from here is a slot nobody in this system issued, and that is
   * still reported rather than cleared.
   */
  ownedSlots: z.array(storedCardSlot),
})

/**
 * The kind on a door event that says a card was held to a reader, with the tag
 * put back together from the two halves the controller logs it in. This is what
 * the admin enrolment screen reads: hold an unissued card to the reader and it
 * shows up as a row to assign.
 */
export const CARD_PRESENTED = 'card-presented'

export const cardReadOutcome = z.enum(['granted', 'denied', 'presented'])
export type CardReadOutcome = z.infer<typeof cardReadOutcome>

export const cardPresentedDetail = z.object({
  cardNumber,
  outcome: cardReadOutcome,
})

export const doorEventReport = z.object({
  kind: z.string().min(1),
  at: z.iso.datetime(),
  detail: z.record(z.string(), z.unknown()).optional(),
})

/** What the door service posts back: the status it read and the events it drained. */
export const doorReportRequest = z.object({
  reportedAt: z.iso.datetime(),
  status: doorStatus,
  events: z.array(doorEventReport),
})

export const doorReportResponse = z.object({
  eventsRecorded: z.int().min(0),
})

/**
 * Commands refused by the lab decision of 2018-02-22, and why.
 *
 * The decision is that the rear door may not be held unlocked from a phone. The
 * list is here, in the package both services read, because it was previously
 * written out twice and the two copies had already drifted: each refused only
 * the literal "unlock-rear" while `unlock` walked straight past and unlocked
 * every door, which is the exact thing the decision forbids. The Rails app it
 * replaces has the same hole, so reproducing its behaviour faithfully would
 * have reproduced the hole.
 *
 * `open-rear` is deliberately NOT here. Open pulses the strike for five seconds
 * and somebody has to be standing at the door to use it. Unlock holds the door
 * open until something locks it again, which is what the decision is about. If
 * the board reads it the other way, add 'open-rear' to this object and the
 * refusal takes effect in both services at once.
 *
 * The API refusal is the rule, and it is what a member sees. The door service
 * checks the same list again because it is the only thing that can reach the
 * controller, and a refusal that close to the hardware is worth the repetition.
 */
export const REFUSED_DOOR_COMMANDS: Partial<Record<DoorCommand, string>> = {
  'unlock-rear':
    'Holding the rear door unlocked is refused by the lab decision of 2018-02-22. Nothing was ' +
    'sent to the controller. Somebody in the building can open that door.',
  unlock:
    'Unlocking every door holds the rear door open, which the lab decision of 2018-02-22 ' +
    'refuses. Nothing was sent to the controller. Unlock the front door instead.',
}

/**
 * The one abstraction in the codebase. Policy lives above it, never inside it,
 * so the rear unlock refusal from 2018-02-22 holds whatever hardware is below.
 */
export interface DoorController {
  status(): Promise<DoorStatus>
  open(door: Door): Promise<void>
  setLock(door: Door | 'all', locked: boolean): Promise<void>
  setAlarm(armed: boolean): Promise<void>
  writeCard(slot: number, permissions: number, tag: string): Promise<void>
  clearCard(slot: number): Promise<void>
  readLog(): Promise<DoorLogEntry[]>
  /**
   * Empties the log. The controller's is a 40 entry ring buffer that it dumps
   * whole, so a reader that does not clear reports the same entries on every
   * pass forever. Read then clear, which is what the Rails app did.
   */
  clearLog(): Promise<void>
}
