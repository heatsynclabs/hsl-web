import { CARD_SLOT_COUNT, type DoorCommand, type DoorLogEntry } from '@hsl/schema'

import type { CardTableRow } from '../../domain/reconcile.ts'

/**
 * The query string protocol of Open_Access_Control_Ethernet, as recorded in
 * docs/legacy-system.md. Every response is HTTP 200 and errors are plain
 * strings in the body, so the codec reads bodies rather than status codes.
 */

/** DoorLog.parse_command in the Rails application, one parameter per command. */
export const COMMAND_PARAMETERS: Record<DoorCommand, string> = {
  'open-front': 'o1',
  'open-rear': 'o2',
  unlock: 'u',
  'unlock-front': 'u=1',
  'unlock-rear': 'u=2',
  lock: 'l',
  'lock-front': 'l=1',
  'lock-rear': 'l=2',
  arm: '2',
  disarm: '1',
}

export const STATUS_PARAMETER = '9'
export const DUMP_CARD_TABLE_PARAMETER = 'a'
export const READ_LOG_PARAMETER = 'z'
export const CLEAR_LOG_PARAMETER = 'y'
export const LOGOUT_PARAMETER = 'e=0000'

/** The substring the firmware answers a login with. */
export const LOGIN_ACCEPTED = 'ok'
/** The substring the firmware answers an accepted card table write with. */
export const WRITE_ACCEPTED = 'cur'

/**
 * Chains the login onto the command, which is the form the firmware logs itself
 * out from. A bare ?e=PASS leaves the whole lab LAN privileged until something
 * logs out or the board reboots, so nothing in this service ever sends one.
 */
export function chained(parameter: string, password: string): string {
  return `?${parameter}&e=${password}`
}

/** ?mNNN&pMMM&tTTTTTTTT, three digit slot, three digit mask, eight hex tag. */
export function writeCardParameter(card: CardTableRow): string {
  return `m${padSlot(card.slot)}&p${padPermissions(card.permissions)}&t${padTag(card.cardNumber)}`
}

export function showSlotParameter(slot: number): string {
  return `s${padSlot(slot)}`
}

export function clearSlotParameter(slot: number): string {
  return `r${padSlot(slot)}`
}

export function padSlot(slot: number): string {
  if (!Number.isInteger(slot) || slot < 0 || slot > CARD_SLOT_COUNT) {
    throw new Error(
      `Slot ${slot} is not an address in the controller's card table, so nothing was sent. ` +
        `The table runs from slot 0 to slot ${CARD_SLOT_COUNT}.`,
    )
  }
  return String(slot).padStart(3, '0')
}

/** The permission mask byte. Production holds 1 on 63 cards and 255 on one. */
export function padPermissions(permissions: number): string {
  if (!Number.isInteger(permissions) || permissions < 0 || permissions > 255) {
    throw new Error(
      `Permission mask ${permissions} is not a byte, so nothing was sent. The controller keeps ` +
        'one byte beside each tag.',
    )
  }
  return String(permissions).padStart(3, '0')
}

/**
 * Card#upload_to_door padded with rjust(8, '0') and the replacement pads the
 * same way. Legacy numbers are five, six or seven hex characters, and a short
 * number padded differently is a different tag on the device.
 */
export function padTag(cardNumber: string): string {
  const trimmed = cardNumber.trim().toUpperCase()
  if (!/^[0-9A-F]{1,8}$/.test(trimmed)) {
    throw new Error(
      `Card number ${cardNumber} is not one to eight hex characters, so nothing was sent. ` +
        'Card numbers reach the controller as eight uppercase hex characters.',
    )
  }
  return trimmed.padStart(8, '0')
}

export function isLoginAccepted(body: string): boolean {
  return body.includes(LOGIN_ACCEPTED)
}

export function isWriteAccepted(body: string): boolean {
  return body.includes(WRITE_ACCEPTED)
}

/** The ?z log, parsed as "key: value" lines. G granted, R read, D denied. */
export function parseLog(body: string): DoorLogEntry[] {
  const entries: DoorLogEntry[] = []
  for (const line of body.split('\n')) {
    const separator = line.indexOf(':')
    if (separator === -1) continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    if (key !== '') entries.push({ key, value })
  }
  return entries
}

/**
 * One line of the ?a dump or the whole answer to ?sNNN.
 *
 * ASSUMPTION: the dump prints one line per occupied slot as
 * "NNN: tTTTTTTTT pMMM" and anything else on the line is framing.
 * CONFIRM BY: running ?a against the controller in the lab and reading it.
 * BLAST RADIUS: reconcile would see an empty card table and rewrite all 64
 * cards on every pass. It would never clear anything, because a slot it cannot
 * read is a slot it does not know it owns.
 */
const CARD_LINE = /^\s*(\d{1,3})\s*:\s*t([0-9A-Fa-f]{8})\s+p(\d{1,3})\s*$/

export function parseCardLine(line: string): CardTableRow | null {
  const match = CARD_LINE.exec(line)
  if (match === null) return null
  const [, slot, tag, permissions] = match
  return {
    slot: Number(slot),
    cardNumber: (tag ?? '').toUpperCase(),
    permissions: Number(permissions),
  }
}

export function parseCardTable(body: string): CardTableRow[] {
  const cards: CardTableRow[] = []
  for (const line of body.split('\n')) {
    const card = parseCardLine(line)
    if (card !== null) cards.push(card)
  }
  return cards
}

/**
 * Every query carries the controller password. Anything that reaches a log line
 * or an error message goes through here first.
 */
export function redactPassword(query: string): string {
  return query.replace(/([?&]e=)[^&]*/g, '$1REDACTED')
}
