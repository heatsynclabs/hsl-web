import { CARD_SLOT_COUNT, LAST_USABLE_CARD_SLOT, type DoorLogEntry } from '@hsl/schema'

import type { CardTableRow } from '../../domain/reconcile.ts'
import type { ControllerTransport } from '../types.ts'

/**
 * An in-memory Open_Access_Control board.
 *
 * Every string below was read out of `Open_Access_Control_Ethernet.ino` on
 * master, commit 60e499c, and the line numbers are in the comments. It is not a
 * convenient stand-in: it answers the bytes the board answers, because the
 * point is to catch a parser that cannot read them. An earlier version of this
 * file invented a friendlier dialect, and three defects hid behind it. See
 * docs/legacy-system.md, "The response formats, read from the firmware".
 *
 * Every test in this service runs against it, the adapter under test is the
 * real one, and services/door/src/simulator serves this same object over HTTP.
 */

/** PROGMEM literals, firmware lines 257 to 262. */
const NOT_LOGGED_IN = "<a href='/'>Not logged in.</a>"
const UNLOCK_ALL = 'Unlocked all.'
const UNLOCK_1 = 'Unlocked 1.'
const UNLOCK_2 = 'Unlocked 2.'
const OPEN_1 = 'Opened 1.'
const OPEN_2 = 'Opened 2.'
const LOCK_ALL = 'Locked all.'

/** Firmware 349 and 352. A failed login breaks the connection loop. */
const LOGIN_OK = 'authok'
const LOGIN_FAIL = 'authfail'

/** printLog walks sizeof(logKeys), which is 40. Firmware 227 to 229, 1615. */
const LOG_SLOTS = 40

/** dumpUser's guard, firmware 1532. Slot 200 is writable and never printed. */
const BAD_USER = 'Bad user number!'

/** An EEPROM slot deleteUser has blanked reads back as this. Firmware 1483. */
const EMPTY_TAG = 0xffffffff
const EMPTY_MASK = 255

export interface FakeDeviceOptions {
  /** The four hex characters the board compares, PRIVPASSWORD at line 112. */
  password: string
  cards?: readonly CardTableRow[]
  log?: readonly DoorLogEntry[]
}

export interface FakeDevice {
  /** Hand this to createArduinoController to drive the fake through real code. */
  transport: ControllerTransport
  /** Every query the device received, newest last, password included. */
  requests: string[]
  cards: Map<number, CardTableRow>
  privileged: boolean
  frontLocked: boolean
  rearLocked: boolean
  /** armAlarm's level: 1 armed, 0 disarmed, 4 door chime. Firmware 430, 510, 518. */
  armed: number
  activated: number
  /** Strike pulses, front and rear, so a test can prove ?o1 did something. */
  pulses: Array<1 | 2>
  /** The ring buffer, 40 fixed slots. An unused slot has the NUL key. */
  logKeys: string[]
  logData: number[]
  logCursor: number
  addToLog(key: string, value: number): void
  handle(query: string): string
}

export function createFakeDevice(options: FakeDeviceOptions): FakeDevice {
  const device: FakeDevice = {
    transport: (query: string) => Promise.resolve(device.handle(query)),
    requests: [],
    cards: new Map((options.cards ?? []).map((card) => [card.slot, { ...card }])),
    privileged: false,
    frontLocked: true,
    rearLocked: true,
    armed: 255,
    activated: 255,
    pulses: [],
    logKeys: Array.from({ length: LOG_SLOTS }, () => '\0'),
    logData: Array.from({ length: LOG_SLOTS }, () => 0),
    logCursor: 0,
    addToLog: (key: string, value: number) => addToLog(device, key, value),
    handle: (query: string) => handle(device, options.password, query),
  }

  for (const entry of options.log ?? []) device.addToLog(entry.key, Number(entry.value))
  return device
}

/** Arduino's println. Every line the board writes ends CRLF. */
function println(lines: string[]): string {
  return lines.map((line) => `${line}\r\n`).join('')
}

/** addToLog, firmware 1606 to 1613. A ring over the 40 slots. */
function addToLog(device: FakeDevice, key: string, value: number): void {
  device.logKeys[device.logCursor] = key
  device.logData[device.logCursor] = value
  device.logCursor = (device.logCursor + 1) % LOG_SLOTS
}

/**
 * One request. The board dispatches on the single character after the first
 * question mark, firmware 359, and re-parses the rest inside each case.
 */
function handle(device: FakeDevice, password: string, query: string): string {
  device.requests.push(query)
  const out: string[] = []

  // Login runs before the switch, firmware 344 to 355.
  if (query.includes('?e=') || query.includes('&e=')) {
    if (!login(device, password, query)) return println([LOGIN_FAIL])
    out.push(LOGIN_OK)
  }

  const mark = query.indexOf('?')
  const dispatch = mark === -1 ? '' : query.slice(mark + 1, mark + 2)

  if (device.privileged) out.push(...runCommand(device, query, dispatch))
  // ?9 is the one call that needs no privilege, firmware 605 to 612.
  else if (query.includes('?9')) out.push(...statusLines(device))
  else out.push(NOT_LOGGED_IN)

  // A chained command logs itself out, firmware 616 to 618.
  if (query.includes('&e=')) device.privileged = false

  return println(out)
}

/**
 * login(), firmware 1563 to 1587. The board reads exactly four characters after
 * "e=" and parses them as hex, so a longer value is truncated and a value with
 * no hex in it parses to zero, which is the logout value.
 */
function login(device: FakeDevice, password: string, query: string): boolean {
  const at = query.indexOf('e=')
  const supplied = query.slice(at + 2, at + 6)
  const accepted = Number.parseInt(password.slice(0, 4), 16)
  device.privileged = Number.parseInt(supplied, 16) === accepted && Number.isFinite(accepted)
  return device.privileged
}

/** The switch at firmware 359, one case per character. */
const COMMANDS: Record<string, (device: FakeDevice, query: string) => string[]> = {
  '9': (device) => statusLines(device),
  a: (device) => dumpAll(device),
  s: (device, query) => showSlot(device, threeDigits(query, '?s')),
  m: (device, query) => writeCard(device, query),
  r: (device, query) => clearSlot(device, threeDigits(query, '?r')),
  z: (device) => logLines(device),
  y: (device) => clearLog(device),
  o: (device, query) => openDoor(device, query),
  u: (device, query) => unlock(device, query),
  l: (device, query) => lock(device, query),
  '1': (device) => disarm(device),
  '2': (device) => arm(device),
}

function runCommand(device: FakeDevice, query: string, dispatch: string): string[] {
  // `default: {}` at firmware 601 prints nothing at all.
  return COMMANDS[dispatch]?.(device, query) ?? []
}

function threeDigits(query: string, prefix: string): number {
  const at = query.indexOf(prefix)
  return at === -1 ? Number.NaN : Number.parseInt(query.slice(at + 2, at + 5), 10)
}

/** printStatus, firmware 1589 to 1604. Six keys, alarm_3 before alarm_2. */
function statusLines(device: FakeDevice): string[] {
  return [
    '{',
    `"armed":${device.armed},"activated":${device.activated}`,
    ',"alarm_3":1',
    ',"alarm_2":1',
    `,"door_1_locked":${device.frontLocked ? 1 : 0}`,
    `,"door_2_locked":${device.rearLocked ? 1 : 0}`,
    '}',
  ]
}

/**
 * dumpUser, firmware 1525 to 1561. Tab separated, slot then mask then tag, all
 * unpadded, and the tag in uppercase hex because DEBUG is 2 at line 105.
 */
function dumpUser(device: FakeDevice, slot: number): string {
  if (!Number.isInteger(slot) || slot < 0 || slot > LAST_USABLE_CARD_SLOT) return BAD_USER

  const card = device.cards.get(slot)
  const tag = card === undefined ? EMPTY_TAG : Number.parseInt(card.cardNumber, 16)
  const mask = card === undefined ? EMPTY_MASK : card.permissions
  return `${slot}\t${mask}\t${tag.toString(16).toUpperCase()}`
}

/** case 'a', firmware 401 to 412. All 200 slots, empty ones included. */
function dumpAll(device: FakeDevice): string[] {
  const rows = Array.from({ length: LAST_USABLE_CARD_SLOT + 1 }, (_, slot) =>
    dumpUser(device, slot),
  )
  return ['<pre>', 'UserNum: Usermask: TagNum:', ...rows, '</pre>']
}

/** case 's', firmware 361 to 374. The same header, then one row. */
function showSlot(device: FakeDevice, slot: number): string[] {
  return ['<pre>', 'UserNum: Usermask: TagNum:', dumpUser(device, slot), '</pre>']
}

/**
 * case 'm', firmware 375 to 400. Note that a write to slot 200 answers with
 * "Bad user number!" between the prev: and cur: lines, so the body still
 * contains "cur" for a write the reader can never see.
 */
function writeCard(device: FakeDevice, query: string): string[] {
  const slot = threeDigits(query, '?m')
  const mask = threeDigits(query, '&p')
  const at = query.indexOf('&t')
  const tag = at === -1 ? '' : query.slice(at + 2, at + 10)

  if (at === -1 || !/^[0-9A-Fa-f]{8}$/.test(tag) || !Number.isInteger(slot)) return ['err:query']

  const previous = dumpUser(device, slot)
  if (Number.isInteger(slot) && slot >= 0 && slot <= CARD_SLOT_COUNT) {
    device.cards.set(slot, { slot, cardNumber: tag.toUpperCase(), permissions: mask })
  }

  return ['<pre>', 'prev:', previous, 'cur:', dumpUser(device, slot), '</pre>']
}

/** case 'r', firmware 414 to 426. It opens a pre block and never closes it. */
function clearSlot(device: FakeDevice, slot: number): string[] {
  const previous = dumpUser(device, slot)
  device.cards.delete(slot)
  return ['r', '<pre>', 'prev:', previous, 'cur:', dumpUser(device, slot)]
}

/** printLog, firmware 1615 to 1625. All 40 slots, whether or not they hold anything. */
function logLines(device: FakeDevice): string[] {
  const lines = device.logKeys.map((key, index) => `${key}: ${device.logData[index] ?? 0}`)
  return ['<pre>', ...lines, '</pre>']
}

function clearLog(device: FakeDevice): string[] {
  device.logKeys = Array.from({ length: LOG_SLOTS }, () => '\0')
  device.logData = Array.from({ length: LOG_SLOTS }, () => 0)
  device.logCursor = 0
  return ['y']
}

/** case 'o', firmware 427 to 450. It prints no status. */
function openDoor(device: FakeDevice, query: string): string[] {
  device.activated = 0
  device.armed = 4
  if (query.includes('?o1')) {
    device.pulses.push(1)
    return [OPEN_1]
  }
  if (query.includes('?o2')) {
    device.pulses.push(2)
    return [OPEN_2]
  }
  return ['err:door#']
}

/** case 'u', firmware 451 to 482. Every branch ends with the status payload. */
function unlock(device: FakeDevice, query: string): string[] {
  const said: string[] = []
  if (query.includes('?u=1')) {
    device.frontLocked = false
    said.push(UNLOCK_1)
  } else if (query.includes('?u=2')) {
    device.rearLocked = false
    said.push(UNLOCK_2)
  } else if (query.includes('?u=')) said.push('err:door#')
  else {
    device.frontLocked = false
    device.rearLocked = false
    said.push(UNLOCK_ALL)
  }

  device.activated = 0
  device.armed = 4
  return [...said, ...statusLines(device)]
}

/**
 * case 'l', firmware 483 to 507. Locking one door prints no literal at all,
 * only the status that follows.
 */
function lock(device: FakeDevice, query: string): string[] {
  const said: string[] = []
  if (query.includes('?l=1')) device.frontLocked = true
  else if (query.includes('?l=2')) device.rearLocked = true
  else {
    device.frontLocked = true
    device.rearLocked = true
    said.push(LOCK_ALL)
  }

  return [...said, ...statusLines(device)]
}

/** case '1', firmware 509 to 515. armAlarm(0), alarmState(0), then status. */
function disarm(device: FakeDevice): string[] {
  device.armed = 0
  device.activated = 0
  return statusLines(device)
}

/** case '2', firmware 516 to 521. armAlarm(1), then status. */
function arm(device: FakeDevice): string[] {
  device.armed = 1
  return statusLines(device)
}
