import { createServer } from 'node:http'

import { createOpenAccess, redact, type Placement, type Transport } from './openaccess.ts'
import type { DoorAdapter } from '../adapter.ts'

/**
 * An Open_Access_Control board, in memory.
 *
 * Every string below was read out of `Open_Access_Control_Ethernet.ino` on
 * master, commit 60e499c, and the line numbers are in the comments. It is not a
 * convenient stand-in: it answers the bytes the board answers, because the
 * point is to catch a parser that cannot read them. An in-process mock proves
 * that the adapter called a function and nothing about what comes back, and
 * three defects that would have fired on the first day against real hardware
 * were found exactly this way.
 *
 * Worth saying out loud every time: this agrees with the firmware reading by
 * construction. It raises confidence in the code and none at all in the
 * reading. Only a trip to the lab settles the reading.
 */

/** PROGMEM literals, lines 256 to 262. */
const NOT_LOGGED_IN = "<a href='/'>Not logged in.</a>"
const LOGIN_OK = 'authok'
const LOGIN_FAIL = 'authfail'

/** printLog walks sizeof(logKeys), which is 40. Lines 227 to 229, 1615. */
const LOG_SLOTS = 40

/** dumpUser's guard, line 1532. Slot 200 is writable and never printed. */
const BAD_USER = 'Bad user number!'
const LAST_PRINTED_SLOT = 199

/** An EEPROM slot deleteUser has blanked reads back as this. Line 1483. */
const EMPTY_TAG = 0xffffffff
const EMPTY_MASK = 255

/** `const int divisor = 32767;`, line 266. */
const DIVISOR = 32767

/**
 * How many queries to remember.
 *
 * The tests read this to count what one pass sent, and a pass sends at most a
 * few hundred, so the oldest going costs them nothing. Unbounded it is about
 * 105 bytes a request, measured at 11 MB per hundred thousand, which is nine
 * days of a simulator at the tick rate and the week that section 5.7 asks for.
 */
const REMEMBERED_REQUESTS = 1000

export interface FakeDevice {
  /** Hand this to createOpenAccess to drive the fake through the real codec. */
  transport: Transport
  handle(query: string): string
  /** Holding a card to the reader. There is no such command on real hardware. */
  present(tag: string, outcome?: 'granted' | 'denied' | 'read'): void
  /** What has been sent, newest last, back to REMEMBERED_REQUESTS. */
  requests: string[]
  cards: Map<number, Placement>
  privileged: boolean
  door1Locked: boolean
  door2Locked: boolean
  armed: number
  activated: number
  /** Strike pulses, so a test can prove ?o1 did something. */
  pulses: Array<1 | 2>
  /** The card table prints tags only on a DEBUG 2 build, line 105. */
  printsTags: boolean
}

export interface FakeDeviceOptions {
  /** The four hex characters the board compares, PRIVPASSWORD at line 112. */
  password: string
  cards?: readonly Placement[]
  /** False for a board built with DEBUG below 2, which prints asterisks. */
  printsTags?: boolean
}

export function createFakeDevice(options: FakeDeviceOptions): FakeDevice {
  const logKeys: string[] = Array.from({ length: LOG_SLOTS }, () => '\0')
  const logData: number[] = Array.from({ length: LOG_SLOTS }, () => 0)
  let cursor = 0

  /**
   * addToLog, lines 1606 to 1613. A ring over the forty slots.
   *
   * Stored through sixteen bits, because the board's entries are that wide. An
   * unbounded store here round trips card ids the hardware cannot carry, and
   * proving a round trip the board cannot do is the one thing a simulator that
   * answers the real bytes exists to prevent. See LOG_TAG_CEILING.
   */
  const sixteenBit = new Int16Array(1)
  const addToLog = (key: string, value: number): void => {
    logKeys[cursor] = key
    sixteenBit[0] = value
    logData[cursor] = sixteenBit[0] as number
    cursor = (cursor + 1) % LOG_SLOTS
  }

  function reset(): void {
    for (let index = 0; index < LOG_SLOTS; index += 1) {
      logKeys[index] = '\0'
      logData[index] = 0
    }
    cursor = 0
  }

  const device: FakeDevice = {
    transport: (query) => Promise.resolve(device.handle(query)),
    handle: (query) => handle(device, options.password, query, { logKeys, logData, clear: reset }),
    present: (tag, outcome = 'denied') => {
      const value = Number.parseInt(tag, 16)
      const key = { granted: 'G', denied: 'D', read: 'R' }[outcome]
      addToLog(key, value % DIVISOR)
      addToLog(key.toLowerCase(), Math.floor(value / DIVISOR))
    },
    requests: [],
    cards: new Map((options.cards ?? []).map((card) => [card.slot, { ...card }])),
    privileged: false,
    door1Locked: true,
    door2Locked: true,
    armed: 255,
    activated: 255,
    pulses: [],
    printsTags: options.printsTags ?? true,
  }

  return device
}

interface Log {
  logKeys: string[]
  logData: number[]
  clear: () => void
}

/** Arduino's println. Every line the board writes ends CRLF. */
function println(lines: string[]): string {
  return lines.map((line) => `${line}\r\n`).join('')
}

/**
 * One request. The board dispatches on the single character after the first
 * question mark, line 359, and re-parses the rest inside each case.
 */
function handle(device: FakeDevice, password: string, query: string, log: Log): string {
  device.requests.push(query)
  if (device.requests.length > REMEMBERED_REQUESTS) device.requests.shift()
  const out: string[] = []

  // Login runs before the switch, lines 344 to 355.
  if (query.includes('?e=') || query.includes('&e=')) {
    if (!login(device, password, query)) return println([LOGIN_FAIL])
    out.push(LOGIN_OK)
  }

  const mark = query.indexOf('?')
  const dispatch = mark === -1 ? '' : query.slice(mark + 1, mark + 2)

  if (device.privileged) out.push(...run(device, query, dispatch, log))
  // ?9 is the one call that needs no privilege, lines 605 to 612.
  else if (query.includes('?9')) out.push(...status(device))
  else out.push(NOT_LOGGED_IN)

  // A chained command logs itself out, lines 616 to 618.
  if (query.includes('&e=')) device.privileged = false

  return println(out)
}

/**
 * login(), lines 1563 to 1587. The board reads exactly four characters after
 * "e=" and parses them as hex, so a longer value is truncated and a value with
 * no hex in it parses to zero, which is the logout value.
 */
function login(device: FakeDevice, password: string, query: string): boolean {
  const at = query.indexOf('e=')
  const supplied = Number.parseInt(query.slice(at + 2, at + 6), 16)
  const accepted = Number.parseInt(password.slice(0, 4), 16)
  device.privileged = Number.isFinite(accepted) && supplied === accepted
  return device.privileged
}

function run(device: FakeDevice, query: string, dispatch: string, log: Log): string[] {
  switch (dispatch) {
    case '9':
      return status(device)
    case 'a':
      return dumpAll(device)
    case 's':
      return showSlot(device, digits(query, '?s'))
    case 'm':
      return writeCard(device, query)
    case 'r':
      return clearSlot(device, digits(query, '?r'))
    case 'z':
      return ['<pre>', ...log.logKeys.map((key, index) => `${key}: ${log.logData[index] ?? 0}`), '</pre>']
    case 'y':
      log.clear()
      return ['y']
    case 'o':
      return openDoor(device, query)
    case 'u':
      return unlock(device, query)
    case 'l':
      return lock(device, query)
    case '1':
      device.armed = 0
      device.activated = 0
      return status(device)
    case '2':
      device.armed = 1
      return status(device)
    default:
      // `default: {}` at line 601 prints nothing at all.
      return []
  }
}

function digits(query: string, prefix: string): number {
  const at = query.indexOf(prefix)
  return at === -1 ? Number.NaN : Number.parseInt(query.slice(at + 2, at + 5), 10)
}

/** printStatus, lines 1589 to 1604. Six keys, alarm_3 before alarm_2. */
function status(device: FakeDevice): string[] {
  return [
    '{',
    `"armed":${device.armed},"activated":${device.activated}`,
    ',"alarm_3":1',
    ',"alarm_2":1',
    `,"door_1_locked":${device.door1Locked ? 1 : 0}`,
    `,"door_2_locked":${device.door2Locked ? 1 : 0}`,
    '}',
  ]
}

/**
 * dumpUser, lines 1525 to 1561. Tab separated, slot then mask then tag, none of
 * them padded, and the tag in uppercase hex only because DEBUG is 2 at line 105.
 */
function dumpUser(device: FakeDevice, slot: number): string {
  if (!Number.isInteger(slot) || slot < 0 || slot > LAST_PRINTED_SLOT) return BAD_USER

  const card = device.cards.get(slot)
  const tag = card === undefined ? EMPTY_TAG : Number.parseInt(card.tag, 16)
  const mask = card === undefined ? EMPTY_MASK : card.mask
  const printed = device.printsTags ? tag.toString(16).toUpperCase() : '********'
  return `${slot}\t${mask}\t${printed}`
}

/** case 'a', lines 401 to 412. All two hundred slots, empty ones included. */
function dumpAll(device: FakeDevice): string[] {
  const rows = Array.from({ length: LAST_PRINTED_SLOT + 1 }, (_, slot) => dumpUser(device, slot))
  return ['<pre>', 'UserNum: Usermask: TagNum:', ...rows, '</pre>']
}

/** case 's', lines 361 to 374. The same header, then one row. */
function showSlot(device: FakeDevice, slot: number): string[] {
  return ['<pre>', 'UserNum: Usermask: TagNum:', dumpUser(device, slot), '</pre>']
}

/**
 * case 'm', lines 375 to 400. A write to slot 200 is accepted by addUser, whose
 * guard is userNum > NUMUSERS, and then printed as "Bad user number!" in both
 * positions, so the body still contains "cur" for a write the reader can never
 * see.
 */
function writeCard(device: FakeDevice, query: string): string[] {
  const slot = digits(query, '?m')
  const mask = digits(query, '&p')
  const at = query.indexOf('&t')
  const tag = at === -1 ? '' : query.slice(at + 2, at + 10)

  if (at === -1 || !/^[0-9A-Fa-f]{8}$/.test(tag) || !Number.isInteger(slot)) return ['err:query']

  const previous = dumpUser(device, slot)
  if (slot >= 0 && slot <= LAST_PRINTED_SLOT + 1) {
    device.cards.set(slot, { slot, mask, tag: tag.toUpperCase() })
  }
  return ['<pre>', 'prev:', previous, 'cur:', dumpUser(device, slot), '</pre>']
}

/** case 'r', lines 414 to 426. It opens a pre block and never closes it. */
function clearSlot(device: FakeDevice, slot: number): string[] {
  const previous = dumpUser(device, slot)
  device.cards.delete(slot)
  return ['r', '<pre>', 'prev:', previous, 'cur:', dumpUser(device, slot)]
}

/** case 'o', lines 427 to 450. It prints no status. */
function openDoor(device: FakeDevice, query: string): string[] {
  device.activated = 0
  device.armed = 4
  if (query.includes('?o1')) {
    device.pulses.push(1)
    return ['Opened 1.']
  }
  if (query.includes('?o2')) {
    device.pulses.push(2)
    return ['Opened 2.']
  }
  return ['err:door#']
}

/** case 'u', lines 451 to 482. Every branch ends with the status payload. */
function unlock(device: FakeDevice, query: string): string[] {
  const said: string[] = []
  if (query.includes('?u=1')) {
    device.door1Locked = false
    said.push('Unlocked 1.')
  } else if (query.includes('?u=2')) {
    device.door2Locked = false
    said.push('Unlocked 2.')
  } else if (query.includes('?u=')) said.push('err:door#')
  else {
    device.door1Locked = false
    device.door2Locked = false
    said.push('Unlocked all.')
  }

  device.activated = 0
  device.armed = 4
  return [...said, ...status(device)]
}

/** case 'l', lines 483 to 507. Locking one door prints no literal at all. */
function lock(device: FakeDevice, query: string): string[] {
  const said: string[] = []
  if (query.includes('?l=1')) device.door1Locked = true
  else if (query.includes('?l=2')) device.door2Locked = true
  else {
    device.door1Locked = true
    device.door2Locked = true
    said.push('Locked all.')
  }
  return [...said, ...status(device)]
}

// ------------------------------------------------------------------------------

/** The same board, reached the way the adapter reaches the real one. */
export function fakeAdapter(
  device: FakeDevice,
  password: string,
  doors: [string, string],
): DoorAdapter {
  return createOpenAccess({ password, transport: device.transport, doors })
}

/**
 * The board on a socket, so development and CI drive the real codec over a real
 * connection rather than a function call.
 *
 * `POST /present` is not the board. A real controller has no such command: the
 * only way to reach the reader on real hardware is to hold a card to it.
 */
export function serveFakeDevice(device: FakeDevice, port: number): ReturnType<typeof createServer> {
  const server = createServer((incoming, response) => {
    const url = incoming.url ?? '/'

    if (incoming.method === 'POST' && url.startsWith('/present')) {
      const tag = new URL(url, 'http://device').searchParams.get('tag') ?? ''
      if (!/^[0-9A-Fa-f]{1,8}$/.test(tag)) {
        response.writeHead(400).end('POST /present?tag=0004B1C7\n')
        return
      }
      device.present(tag.toUpperCase().padStart(8, '0'))
      response.writeHead(200).end(`presented ${tag}\n`)
      return
    }

    const mark = url.indexOf('?')
    const query = mark === -1 ? '' : url.slice(mark)
    process.stdout.write(`${JSON.stringify({ evt: 'device_request', query: redact(query) })}\n`)
    response.writeHead(200, { 'content-type': 'text/html' }).end(device.handle(query))
  })

  return server.listen(port)
}

if (import.meta.filename === process.argv[1]) {
  const port = Number(process.env.PORT ?? 8080)
  serveFakeDevice(createFakeDevice({ password: process.env.CONTROLLER_PASSWORD ?? '1234' }), port)
  process.stdout.write(`${JSON.stringify({ evt: 'simulator_listening', port })}\n`)
}
