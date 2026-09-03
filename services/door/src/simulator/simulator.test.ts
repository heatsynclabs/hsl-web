import type { AddressInfo } from 'node:net'

import { serve } from '@hono/node-server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createFakeDevice, type FakeDevice } from '../adapters/fake/device.ts'
import {
  createArduinoController,
  createHttpTransport,
} from '../adapters/openaccess-arduino/controller.ts'
import type { DoorAdapter } from '../adapters/types.ts'
import { readCards, unknownCards } from '../domain/reads.ts'
import { planReconcile } from '../domain/reconcile.ts'
import { createSimulatorApp } from './app.ts'

/**
 * The door service against a controller, over a real socket.
 *
 * Everything else in this service drives the adapter through an in-process
 * function. This suite is the only place createHttpTransport runs, so it is the
 * only thing that would notice a request that never leaves, a body read the
 * wrong way, or a response the codec cannot parse. It is also the shape of the
 * loop a person can run by hand: see services/door/README.md.
 *
 * What it cannot do is confirm the wire format. The simulator answers the bytes
 * this repository read out of the firmware, so it agrees with that reading by
 * construction. HANDOFF.md section 6 stays open.
 */

const PASSWORD = '1234'

let device: FakeDevice
let adapter: DoorAdapter
let baseUrl: string
let server: ReturnType<typeof serve>

beforeAll(async () => {
  device = createFakeDevice({ password: PASSWORD })
  // Port 0 so a second run, or a machine already using 8090, cannot collide.
  server = serve({ fetch: createSimulatorApp({ device }).fetch, port: 0, hostname: '127.0.0.1' })
  await new Promise((resolve) => server.once('listening', resolve))

  const address = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}`
  adapter = createArduinoController({ password: PASSWORD, transport: createHttpTransport(baseUrl) })
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
})

async function present(cardNumber: string): Promise<string> {
  const response = await fetch(`${baseUrl}/simulate/present`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cardNumber }),
  })
  const body = (await response.json()) as { outcome: string }
  return body.outcome
}

describe('the door service against a simulated controller, over HTTP', () => {
  it('reads the status the board reports, past the login line it prints first', async () => {
    const status = await adapter.status()

    expect(status).toMatchObject({ frontLocked: true, rearLocked: true })
  })

  it('writes a card and reads the same card back out of the dump', async () => {
    await adapter.writeCard(14, 1, '0001E240')

    expect(await adapter.readCardTable()).toEqual([
      { slot: 14, cardNumber: '0001E240', permissions: 1 },
    ])
  })

  it('reads one slot on its own, which is a different response shape', async () => {
    expect(await adapter.readCard(14)).toEqual({
      slot: 14,
      cardNumber: '0001E240',
      permissions: 1,
    })
    expect(await adapter.readCard(15)).toBeNull()
  })

  it('keeps a short card number at the width the controller stores it', async () => {
    await adapter.writeCard(15, 1, '0000C8C8')

    // The board prints C8C8 unpadded. A short number that comes back a
    // different width is a different tag, and reconcile would rewrite it every
    // pass forever.
    expect(await adapter.readCard(15)).toMatchObject({ cardNumber: '0000C8C8' })
  })

  it('clears a slot and leaves its neighbours alone', async () => {
    await adapter.clearCard(15)

    const table = await adapter.readCardTable()
    expect(table.map((card) => card.slot)).toEqual([14])
  })

  it('opens a door and changes a lock, without either one lying about the other', async () => {
    await adapter.open('front')
    expect(device.pulses).toEqual([1])

    await adapter.setLock('front', false)
    expect((await adapter.status()).frontLocked).toBe(false)

    await adapter.setLock('all', true)
    expect((await adapter.status()).frontLocked).toBe(true)
  })

  it('arms and disarms, reading the level the board actually sets', async () => {
    await adapter.setAlarm(true)
    expect(device.armed).toBe(1)

    await adapter.setAlarm(false)
    expect(device.armed).toBe(0)
  })

  /**
   * The whole reason the enrolment screen exists. An admin holds an unissued
   * card to the reader, and the number has to arrive without anybody doing
   * arithmetic on two log rows by hand.
   */
  it('carries a card held to the reader all the way to an enrolable number', async () => {
    await adapter.clearLog()
    expect(await present('0004B1C7')).toBe('denied')

    const reads = readCards(await adapter.readLog())
    const unknown = unknownCards(reads, new Set(['0001E240']))

    expect(unknown).toEqual([{ cardNumber: '0004B1C7', outcome: 'denied' }])
  })

  it('grants the same card once it has been written to a slot the reader scans', async () => {
    await adapter.writeCard(16, 1, '0004B1C7')

    expect(await present('0004B1C7')).toBe('granted')
  })

  it('drops the thirty eight empty log slots the board prints every time', async () => {
    await adapter.clearLog()

    expect(await adapter.readLog()).toEqual([])
  })

  /**
   * Section 4 of CONTRIBUTING asks for this, and until now it was only ever
   * proven in process. A second pass that writes again would rewrite all 64
   * cards every minute against real hardware.
   */
  it('reconciles to an empty plan on the second pass, over the wire', async () => {
    const databaseCards = await adapter.readCardTable()
    const ownedSlots = new Set(databaseCards.map((card) => card.slot))

    const first = planReconcile({
      databaseCards,
      controllerCards: await adapter.readCardTable(),
      ownedSlots,
    })
    expect(first.writes).toEqual([])
    expect(first.clears).toEqual([])

    for (const card of first.writes) {
      await adapter.writeCard(card.slot, card.permissions, card.cardNumber)
    }

    const second = planReconcile({
      databaseCards,
      controllerCards: await adapter.readCardTable(),
      ownedSlots,
    })
    expect(second.writes).toEqual([])
    expect(second.clears).toEqual([])
  })

  it('refuses a wrong password over the wire rather than quietly doing nothing', async () => {
    const wrong = createArduinoController({
      password: '9999',
      transport: createHttpTransport(baseUrl),
    })

    await expect(wrong.writeCard(20, 1, '0001E240')).rejects.toThrow(/card table was not changed/)
    expect(device.cards.has(20)).toBe(false)
  })
})
