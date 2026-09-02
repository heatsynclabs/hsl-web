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

  const api = new Hono()
  api.get(CARD_TABLE_PATH, (context) =>
    context.json({ generatedAt: new Date().toISOString(), cards: databaseCards }),
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
    space.device.log.push({ key: 'G', value: '12345' })

    await runPass(space.deps)

    expect(space.reports[0]).toMatchObject({ status: { frontLocked: true, rearLocked: true } })
    expect(kinds(space)).toContain('controller-log')
    expect(space.device.log).toEqual([])
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
