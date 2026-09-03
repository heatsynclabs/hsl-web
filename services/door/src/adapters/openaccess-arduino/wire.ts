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

/**
 * A write or a clear the board carried out.
 *
 * The board frames both with a "cur:" line and prints the slot back underneath
 * it. A slot above 199 answers "Bad user number!" in that position, firmware
 * line 1560, and the body still contains "cur", so the substring on its own
 * reports success for a write that can never open a door.
 */
export function isWriteAccepted(body: string): boolean {
  return body.includes(WRITE_ACCEPTED) && !body.includes(BAD_USER_NUMBER)
}

/** dumpUser's refusal for a slot it cannot print, firmware 1560. */
export const BAD_USER_NUMBER = 'Bad user number!'

/**
 * The ?z log. G granted, R read, D denied, with the lowercase partner carrying
 * the high half of the same tag.
 *
 * printLog walks all forty slots whether or not they hold anything, firmware
 * 1615 to 1625, and an unused slot prints its NUL key followed by ": 0". A NUL
 * survives trim(), so entries are kept only for a printable key.
 */
export function parseLog(body: string): DoorLogEntry[] {
  const entries: DoorLogEntry[] = []
  for (const line of lines(body)) {
    const separator = line.indexOf(':')
    if (separator === -1) continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    if (/^[A-Za-z]$/.test(key)) entries.push({ key, value })
  }
  return entries
}

/** Arduino's println writes CRLF, so a body split on \n alone keeps the \r. */
export function lines(body: string): string[] {
  return body.split(/\r?\n/)
}

/**
 * One row of the ?a dump or of ?sNNN.
 *
 * dumpUser prints slot, then the permission mask, then the tag, separated by
 * tabs and none of them padded, firmware 1545 to 1551. The mask comes before
 * the tag. The tag is uppercase hex only because DEBUG is 2 at line 105: a
 * board built with DEBUG 0 or 1 prints asterisks there and no readback is
 * possible, which is HANDOFF section 6 item 3.
 */
const CARD_ROW = /^(\d{1,3})\t(\d{1,3})\t([0-9A-Fa-f]{1,8})$/

/**
 * checkUser refuses 0xFFFFFFFF and 0x0, firmware 1511, and deleteUser writes
 * 0xFF across the slot, firmware 1483. Both read back as a row and neither is
 * a card, so neither is one here.
 */
const EMPTY_TAGS = new Set(['FFFFFFFF', '00000000'])

export function parseCardLine(line: string): CardTableRow | null {
  const match = CARD_ROW.exec(line.trimEnd())
  if (match === null) return null

  const [, slot, permissions, tag] = match
  const cardNumber = (tag ?? '').toUpperCase().padStart(8, '0')
  if (EMPTY_TAGS.has(cardNumber)) return null

  return { slot: Number(slot), cardNumber, permissions: Number(permissions) }
}

/**
 * The occupied slots of a ?a dump. The board prints all two hundred every time,
 * framed by a pre block and a header, so most rows are empty and are dropped.
 */
export function parseCardTable(body: string): CardTableRow[] {
  const cards: CardTableRow[] = []
  for (const line of lines(body)) {
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
