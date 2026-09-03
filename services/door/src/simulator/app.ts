import { Hono } from 'hono'
import { z } from 'zod'

import { redactPassword } from '../adapters/openaccess-arduino/wire.ts'
import type { FakeDevice } from '../adapters/fake/device.ts'
import { outcomeFor, readEntries } from './present.ts'

/**
 * The Open_Access_Control board, served over HTTP.
 *
 * The board itself is adapters/fake/device.ts, the same one every test in this
 * service runs against. This file is only a transport, so there is one
 * implementation of the protocol rather than two that drift, and a wrong reading
 * of the firmware is wrong in both places at once rather than hidden in one.
 *
 * What this proves: the real adapter, the real codec and the real HTTP
 * transport work end to end against something that answers the way the board is
 * documented to answer. What it cannot prove: that the documentation is right.
 * The dump format in wire.ts is still an ASSUMPTION and this agrees with it.
 * HANDOFF.md section 6 stays open.
 */

export interface SimulatorOptions {
  device: FakeDevice
  /** Called with every query the board received, password already redacted. */
  onRequest?: (query: string) => void
}

const PRESENT_USAGE =
  'Send { "cardNumber": "0004B1C7" } and optionally an outcome of granted, denied or presented. ' +
  'Nothing was written to the log.'

const presentRequest = z.object({
  cardNumber: z.string().regex(/^[0-9A-Fa-f]{1,8}$/),
  outcome: z.enum(['granted', 'denied', 'presented']).optional(),
})

/**
 * The raw query string, question mark included.
 *
 * The firmware takes bare parameters like `?o1&e=PASS`, which are not key and
 * value pairs, so what the device gets is the string as sent rather than
 * anything Hono has parsed out of it.
 */
function rawQuery(url: string): string {
  const start = url.indexOf('?')
  return start === -1 ? '' : url.slice(start)
}

/** What the device is holding, for a person looking at it. Not the board. */
function stateOf(device: FakeDevice) {
  return {
    privileged: device.privileged,
    frontLocked: device.frontLocked,
    rearLocked: device.rearLocked,
    armed: device.armed,
    strikePulses: device.pulses,
    cards: [...device.cards.values()].sort((a, b) => a.slot - b.slot),
    log: device.logKeys
      .map((key, index) => ({ key, value: device.logData[index] ?? 0 }))
      .filter((entry) => entry.key !== '\0'),
  }
}

export function createSimulatorApp(options: SimulatorOptions) {
  const app = new Hono()
  const { device } = options

  // The board. Everything on this route is the wire protocol from
  // docs/legacy-system.md and nothing else belongs here.
  app.get('/', (context) => {
    const query = rawQuery(context.req.url)
    options.onRequest?.(redactPassword(query))
    return context.text(device.handle(query))
  })

  /**
   * Not the board. A real controller has no such command: this is the reader,
   * and the only way to reach it on real hardware is to hold a card to it.
   */
  app.post('/simulate/present', async (context) => {
    const parsed = presentRequest.safeParse(await context.req.json().catch(() => null))
    if (!parsed.success) {
      return context.json({ error: PRESENT_USAGE }, 400)
    }

    const cardNumber = parsed.data.cardNumber.toUpperCase().padStart(8, '0')
    const outcome = parsed.data.outcome ?? outcomeFor(device.cards, cardNumber)
    // Through addToLog, so the pair lands in the ring the way the board writes
    // it and wraps at the fortieth entry the way the board wraps.
    for (const entry of readEntries(cardNumber, outcome)) {
      device.addToLog(entry.key, Number(entry.value))
    }

    return context.json({ cardNumber, outcome })
  })

  app.get('/simulate/state', (context) => context.json(stateOf(device)))

  return app
}
