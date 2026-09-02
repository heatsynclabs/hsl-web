import { CARD_SLOT_COUNT, LAST_USABLE_CARD_SLOT, type DoorLogEntry } from '@hsl/schema'

import type { CardTableRow } from '../../domain/reconcile.ts'
import type { ControllerTransport } from '../types.ts'

/**
 * An in-memory Open_Access_Control board. It speaks the wire protocol from
 * docs/legacy-system.md, answers with the same strings the firmware answers
 * with, and keeps the same 201 slot table the firmware keeps: addUser accepts
 * slot 200 and checkUser never reads it back.
 *
 * Every test in this service runs against it, and the adapter under test is the
 * real one. There is no mocked controller anywhere.
 *
 * ASSUMPTION: commands other than the card writes also accept the chained
 * &e=PASS form, and the board answers a command it will not run with a string
 * containing neither "ok" nor "cur".
 * CONFIRM BY: pointing the conformance suite at the board in the lab.
 * BLAST RADIUS: commands would silently do nothing while the service reported
 * success. Reconcile is unaffected, because a card write is checked for "cur".
 */

const REFUSED = 'priv mode disabled'
const UNKNOWN = 'unknown command'

export interface FakeDeviceOptions {
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
  log: DoorLogEntry[]
  privileged: boolean
  frontLocked: boolean
  rearLocked: boolean
  armed: number
  /** Strike pulses, front and rear, so a test can prove ?o1 did something. */
  pulses: Array<1 | 2>
  handle(query: string): string
}

export function createFakeDevice(options: FakeDeviceOptions): FakeDevice {
  const device: FakeDevice = {
    transport: (query: string) => Promise.resolve(device.handle(query)),
    requests: [],
    cards: new Map((options.cards ?? []).map((card) => [card.slot, { ...card }])),
    log: [...(options.log ?? [])],
    privileged: false,
    frontLocked: true,
    rearLocked: true,
    armed: 255,
    pulses: [],
    handle: (query: string) => handle(device, options.password, query),
  }
  return device
}

function handle(device: FakeDevice, password: string, query: string): string {
  device.requests.push(query)
  const parameters = query.replace(/^\?/, '').split('&').filter((part) => part !== '')
  const last = parameters.at(-1)
  if (last === undefined) return UNKNOWN

  if (!last.startsWith('e=')) return runCommand(device, parameters)

  const supplied = last.slice(2)
  const command = parameters.slice(0, -1)
  if (command.length === 0) return handleSession(device, password, supplied)

  if (supplied !== password) return REFUSED
  device.privileged = true
  const answer = runCommand(device, command)
  // The board logs itself out after a chained command. That is the whole reason
  // this service never sends a bare login.
  device.privileged = false
  return answer
}

function handleSession(device: FakeDevice, password: string, supplied: string): string {
  if (supplied === '0000') {
    device.privileged = false
    return 'ok'
  }
  if (supplied !== password) return REFUSED
  device.privileged = true
  return 'ok'
}

function runCommand(device: FakeDevice, parameters: string[]): string {
  if (!device.privileged) return REFUSED
  const first = parameters[0] ?? ''

  if (first === '9') return statusPayload(device)
  if (first === 'a') return dumpCardTable(device)
  if (first === 'z') return device.log.map((entry) => `${entry.key}: ${entry.value}`).join('\n')
  if (first === 'y') {
    device.log = []
    return 'ok'
  }
  if (first.startsWith('m')) return writeCard(device, parameters)
  if (first.startsWith('s')) return showSlot(device, Number(first.slice(1)))
  if (first.startsWith('r')) return clearSlot(device, Number(first.slice(1)))
  return runSimpleCommand(device, first)
}

function runSimpleCommand(device: FakeDevice, parameter: string): string {
  const effects: Record<string, () => void> = {
    o1: () => device.pulses.push(1),
    o2: () => device.pulses.push(2),
    u: () => setLocks(device, false, false),
    'u=1': () => setLocks(device, false, device.rearLocked),
    'u=2': () => setLocks(device, device.frontLocked, false),
    l: () => setLocks(device, true, true),
    'l=1': () => setLocks(device, true, device.rearLocked),
    'l=2': () => setLocks(device, device.frontLocked, true),
    '1': () => {
      device.armed = 0
    },
    '2': () => {
      device.armed = 255
    },
  }
  const effect = effects[parameter]
  if (effect === undefined) return UNKNOWN
  effect()
  return 'ok'
}

function setLocks(device: FakeDevice, front: boolean, rear: boolean): void {
  device.frontLocked = front
  device.rearLocked = rear
}

function statusPayload(device: FakeDevice): string {
  return JSON.stringify({
    armed: device.armed,
    activated: 255,
    alarm_3: 1,
    alarm_2: 1,
    door_1_locked: device.frontLocked ? 1 : 0,
    door_2_locked: device.rearLocked ? 1 : 0,
  })
}

function writeCard(device: FakeDevice, parameters: string[]): string {
  const slot = Number(parameters[0]?.slice(1))
  const permissions = Number(parameters.find((p) => p.startsWith('p'))?.slice(1))
  const tag = parameters.find((p) => p.startsWith('t'))?.slice(1) ?? ''

  // addUser refuses only when userNum > NUMUSERS, so slot 200 is accepted here
  // exactly as the board accepts it, and the dump below never reads it back.
  if (!Number.isInteger(slot) || slot < 0 || slot > CARD_SLOT_COUNT) return UNKNOWN
  if (!Number.isInteger(permissions) || !/^[0-9A-Fa-f]{8}$/.test(tag)) return UNKNOWN

  device.cards.set(slot, { slot, cardNumber: tag.toUpperCase(), permissions })
  return `cur ${String(slot).padStart(3, '0')}`
}

function clearSlot(device: FakeDevice, slot: number): string {
  if (!Number.isInteger(slot) || slot < 0 || slot > CARD_SLOT_COUNT) return UNKNOWN
  device.cards.delete(slot)
  return `cur ${String(slot).padStart(3, '0')}`
}

function showSlot(device: FakeDevice, slot: number): string {
  if (!Number.isInteger(slot) || slot < 0 || slot > CARD_SLOT_COUNT) return UNKNOWN
  const card = readableCards(device).get(slot)
  if (card === undefined) return `${String(slot).padStart(3, '0')}: empty`
  return cardLine(card)
}

function dumpCardTable(device: FakeDevice): string {
  const lines = [...readableCards(device).values()]
    .sort((a, b) => a.slot - b.slot)
    .map(cardLine)
  return ['users:', ...lines].join('\n')
}

/**
 * checkUser stops at byte offset 1019, so slot 199 is the last one the reader
 * can match and slot 200 is invisible however it was written.
 */
function readableCards(device: FakeDevice): Map<number, CardTableRow> {
  const readable = new Map<number, CardTableRow>()
  for (const [slot, card] of device.cards) {
    if (slot <= LAST_USABLE_CARD_SLOT) readable.set(slot, card)
  }
  return readable
}

function cardLine(card: CardTableRow): string {
  const slot = String(card.slot).padStart(3, '0')
  const permissions = String(card.permissions).padStart(3, '0')
  return `${slot}: t${card.cardNumber} p${permissions}`
}
