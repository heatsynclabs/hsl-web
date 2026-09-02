import { CARD_SLOT_COUNT } from '@hsl/schema'
import { describe, expect, it } from 'vitest'

import { runDoorAdapterConformance } from '../conformance.ts'
import { createArduinoController } from '../openaccess-arduino/controller.ts'
import { redactPassword } from '../openaccess-arduino/wire.ts'
import { createFakeDevice, type FakeDevice } from './device.ts'

const PASSWORD = '1234'

function connect(): { device: FakeDevice; adapter: ReturnType<typeof createArduinoController> } {
  const device = createFakeDevice({
    password: PASSWORD,
    cards: [{ slot: 14, cardNumber: '0001E240', permissions: 1 }],
    log: [
      { key: 'G', value: '12345' },
      { key: 'D', value: '999' },
    ],
  })
  return {
    device,
    adapter: createArduinoController({ password: PASSWORD, transport: device.transport }),
  }
}

runDoorAdapterConformance('the fake board', async () => ({
  adapter: connect().adapter,
  scratchSlots: [20, 21],
  mayClearEventLog: true,
}))

describe('the fake board on the wire', () => {
  it('never receives a bare login, whatever the adapter is asked to do', async () => {
    const { device, adapter } = connect()

    await adapter.status()
    await adapter.open('front')
    await adapter.setLock('all', true)
    await adapter.setAlarm(false)
    await adapter.writeCard(20, 1, '0001E240')
    await adapter.readCard(20)
    await adapter.readCardTable()
    await adapter.clearCard(20)
    await adapter.readLog()
    await adapter.clearLog()

    expect(device.requests.length).toBe(10)
    for (const request of device.requests) {
      expect(request).toMatch(/&e=1234$/)
      expect(request).not.toBe('?e=1234')
    }
  })

  it('logs itself out after every chained command, so the lab LAN is never left privileged', async () => {
    const { device, adapter } = connect()
    await adapter.status()
    expect(device.privileged).toBe(false)
  })

  it('answers a bare login with ok and stays privileged, which is why nothing sends one', () => {
    const { device } = connect()
    expect(device.handle('?e=1234')).toContain('ok')
    expect(device.privileged).toBe(true)
    expect(device.handle('?e=0000')).toContain('ok')
    expect(device.privileged).toBe(false)
  })

  it('refuses a command from a session that never logged in', () => {
    const { device } = connect()
    expect(device.handle('?9')).not.toContain('ok')
    expect(device.handle('?m020&p001&t0001E240')).not.toContain('cur')
  })

  it('answers ?9 with the payload the firmware sends', () => {
    const { device } = connect()
    expect(JSON.parse(device.handle('?9&e=1234'))).toEqual({
      armed: 255,
      activated: 255,
      alarm_3: 1,
      alarm_2: 1,
      door_1_locked: 1,
      door_2_locked: 1,
    })
  })

  it('accepts a write to slot 200 and never reads it back, exactly as the firmware does', async () => {
    const { device, adapter } = connect()

    await adapter.writeCard(CARD_SLOT_COUNT, 1, '00ABCDEF')
    expect(device.cards.get(CARD_SLOT_COUNT)).toMatchObject({ cardNumber: '00ABCDEF' })

    expect(await adapter.readCard(CARD_SLOT_COUNT)).toBeNull()
    expect(await adapter.readCardTable()).not.toContainEqual(
      expect.objectContaining({ slot: CARD_SLOT_COUNT }),
    )
  })

  it('reports a refused write instead of pretending the card table changed', async () => {
    const device = createFakeDevice({ password: PASSWORD })
    const adapter = createArduinoController({ password: 'wrong', transport: device.transport })

    await expect(adapter.writeCard(20, 1, '0001E240')).rejects.toThrow(/card table was not changed/)
    expect(device.cards.size).toBe(0)
  })

  it('keeps the controller password out of the error it raises', async () => {
    const device = createFakeDevice({ password: PASSWORD })
    const adapter = createArduinoController({ password: 'hunter2', transport: device.transport })

    const failure = await adapter.writeCard(20, 1, '0001E240').catch((error: Error) => error)
    expect(String(failure)).not.toContain('hunter2')
    expect(redactPassword('?9&e=hunter2')).toBe('?9&e=REDACTED')
  })
})
