import { CARD_SLOT_COUNT } from '@hsl/schema'
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'

import { createArduinoController } from './adapters/openaccess-arduino/controller.ts'
import { createFakeDevice, type FakeDevice } from './adapters/fake/device.ts'
import type { CardTableRow } from './domain/reconcile.ts'
import { createApiLink, CARD_TABLE_PATH, COMMANDS_PATH, REPORT_PATH } from './link.ts'
import { runPass, runReconcilePass, type LoopDependencies } from './main.ts'

const PASSWORD = '1234'
const TOKEN = 'door-token-for-tests'

const CARD_14: CardTableRow = { slot: 14, cardNumber: '0001E240', permissions: 1 }
const CARD_199: CardTableRow = { slot: 199, cardNumber: '00ABCDEF', permissions: 255 }

interface Lab {
  deps: LoopDependencies
  device: FakeDevice
  databaseCards: CardTableRow[]
  issuedSlots: number[]
  queuedCommands: string[]
  reports: Array<{ events: Array<{ kind: string; detail?: Record<string, unknown> }> }>
  cardWrites(): string[]
}

/**
 * The lab, in memory: the real adapter over the fake board, and the real link
 * over a stand in for services/api.
 */
function lab(controllerCards: CardTableRow[] = []): Lab {
  const device = createFakeDevice({ password: PASSWORD, cards: controllerCards })
  const databaseCards: CardTableRow[] = []
  const queuedCommands: string[] = []
  const reports: Lab['reports'] = []

  // Every slot the members database has a row for, active or not, which is what
  // the real API sends. A revoked card leaves `cards` but stays here.
  const issuedSlots: number[] = []

  const api = new Hono()
  api.get(CARD_TABLE_PATH, (context) =>
    context.json({
      generatedAt: new Date().toISOString(),
      cards: databaseCards,
      ownedSlots: issuedSlots,
    }),
  )
  api.get(COMMANDS_PATH, (context) => context.json({ commands: queuedCommands.splice(0) }))
  api.post(REPORT_PATH, async (context) => {
    const body = await context.req.json()
    reports.push(body)
    return context.json({ eventsRecorded: body.events.length })
  })

  const link = createApiLink({
    apiUrl: 'http://api.test',
    doorToken: TOKEN,
    fetchImpl: ((input: string | URL, init?: RequestInit) =>
      api.request(String(input), init)) as typeof fetch,
  })

  return {
    deps: {
      controller: createArduinoController({ password: PASSWORD, transport: device.transport }),
      link,
      ownedSlots: new Set<number>(),
    },
    device,
    databaseCards,
    issuedSlots,
    queuedCommands,
    reports,
    cardWrites: () => device.requests.filter((request) => request.startsWith('?m')),
  }
}

describe('the reconcile loop', () => {
  it('writes the cards the controller is missing', async () => {
    const space = lab()
    space.databaseCards.push(CARD_14, CARD_199)

    const plan = await runReconcilePass(space.deps)

    expect(plan.writes).toEqual([CARD_14, CARD_199])
    expect(space.device.cards.get(14)).toEqual(CARD_14)
    expect(space.device.cards.get(199)).toEqual(CARD_199)
  })

  it('running it twice writes nothing the second time', async () => {
    const space = lab()
    space.databaseCards.push(CARD_14, CARD_199)

    const first = await runReconcilePass(space.deps)
    const writesAfterFirstPass = space.cardWrites().length
    const second = await runReconcilePass(space.deps)

    expect(first.writes).toHaveLength(2)
    expect(second.writes).toEqual([])
    expect(second.clears).toEqual([])
    expect(space.cardWrites()).toHaveLength(writesAfterFirstPass)
  })

  it('leaves every slot where it was', async () => {
    const space = lab()
    space.databaseCards.push(CARD_14, CARD_199)

    await runReconcilePass(space.deps)
    await runReconcilePass(space.deps)

    expect([...space.device.cards.keys()].sort((a, b) => a - b)).toEqual([14, 199])
    expect(space.device.cards.get(14)?.cardNumber).toBe('0001E240')
    expect(space.device.cards.get(199)?.cardNumber).toBe('00ABCDEF')
  })

  it('reports a card the controller holds that the database does not, and leaves it there', async () => {
    const space = lab([CARD_199])
    space.databaseCards.push(CARD_14)

    await runPass(space.deps)

    expect(space.device.cards.get(199)).toEqual(CARD_199)
    expect(kinds(space)).toContain('card-on-controller-not-in-database')
  })

  it('clears a slot once the database has stopped claiming it', async () => {
    const space = lab()
    space.databaseCards.push(CARD_14, CARD_199)
    await runReconcilePass(space.deps)

    space.databaseCards.splice(1, 1)
    const plan = await runReconcilePass(space.deps)

    expect(plan.clears).toEqual([199])
    expect(space.device.cards.has(199)).toBe(false)
    expect(space.device.cards.get(14)).toEqual(CARD_14)
  })

  it('carries the card at slot 200 without crashing, and reports it as unusable', async () => {
    const space = lab()
    space.databaseCards.push({ slot: CARD_SLOT_COUNT, cardNumber: '00ABCDEF', permissions: 1 }, CARD_14)

    await runPass(space.deps)

    expect(space.device.cards.has(CARD_SLOT_COUNT)).toBe(false)
    expect(space.device.cards.get(14)).toEqual(CARD_14)
    expect(kinds(space)).toContain('card-slot-refused')
  })

  it('posts the status and drains the event log once the API has taken it', async () => {
    const space = lab()
    // A login, which carries no tag and so passes through as it came off the
    // device. The log is a 40 entry ring buffer the firmware dumps whole, so a
    // pass that did not clear would report the same entries forever.
    space.device.log.push({ key: 'S', value: '0' })

    await runPass(space.deps)

    expect(space.reports[0]).toMatchObject({ status: { frontLocked: true, rearLocked: true } })
    expect(kinds(space)).toContain('controller-log')
    expect(space.device.log).toEqual([])
  })

  it('reports a card held to the reader as one event carrying the whole tag', async () => {
    const space = lab()
    // How the firmware logs a refused read of tag 0x0000A1B2: the low half
    // under D, the high half under d, divisor 32767.
    space.device.log.push({ key: 'D', value: String(0xa1b2 % 32767) })
    space.device.log.push({ key: 'd', value: String(Math.floor(0xa1b2 / 32767)) })

    await runPass(space.deps)

    const presented = space.reports[0]?.events.filter((event) => event.kind === 'card-presented')
    expect(presented).toEqual([
      expect.objectContaining({ detail: { cardNumber: '0000A1B2', outcome: 'denied' } }),
    ])
  })

  it('does not also report the two halves raw, which no admin could read', async () => {
    const space = lab()
    space.device.log.push({ key: 'D', value: String(0xa1b2 % 32767) })
    space.device.log.push({ key: 'd', value: String(Math.floor(0xa1b2 / 32767)) })

    await runPass(space.deps)

    expect(kinds(space)).not.toContain('controller-log')
  })

  it('runs the commands the API queued and refuses the rear unlock among them', async () => {
    const space = lab()
    space.queuedCommands.push('open-front', 'unlock-rear')

    await runPass(space.deps)

    expect(space.device.pulses).toEqual([1])
    expect(space.device.rearLocked).toBe(true)
  })
})

function kinds(target: Lab): string[] {
  return target.reports.flatMap((report) => report.events.map((event) => event.kind))
}

/**
 * Revoking a card has to survive a restart of this service.
 *
 * Ownership used to be a set in process memory that started empty at boot. A
 * card revoked while the door service was down had left the write list and was
 * no longer owned, so the first pass after the restart reported it instead of
 * clearing it, and nothing ever cleared it afterwards. The fob went on opening
 * the door for as long as the controller held it.
 */
describe('a card revoked while this service was down', () => {
  it('is cleared off the controller on the first pass after a restart', async () => {
    // The controller holds the card. The database still has the row, because a
    // revoked card keeps its slot, but it is no longer one to write.
    const space = lab([{ slot: 41, cardNumber: '0000A1B2', permissions: 1 }])
    space.issuedSlots.push(41)

    // A fresh process: nothing has been written by this instance yet.
    expect(space.deps.ownedSlots.size).toBe(0)

    await runPass(space.deps)

    expect(space.device.cards.has(41)).toBe(false)
  })

  it('still refuses to clear a slot this system never issued', async () => {
    // Somebody wrote a card straight to the controller. It belongs to a
    // decision nobody recorded, so it is reported rather than removed.
    const space = lab([{ slot: 60, cardNumber: '0000C4D9', permissions: 1 }])

    await runPass(space.deps)

    expect(space.device.cards.has(60)).toBe(true)
    expect(space.reports[0]?.events.map((event) => event.kind)).toContain(
      'card-on-controller-not-in-database',
    )
  })
})
