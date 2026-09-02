/* eslint-disable max-lines-per-function -- one describe block of small cases; splitting what a controller has to do across files would hide it. */
import { describe, expect, it } from 'vitest'

import type { DoorAdapter } from './types.ts'

/**
 * What a DoorController has to do, asserted through the interface and nothing
 * else. The fake runs it in CI. Pointing it at the board in the lab means
 * building the same adapter over createHttpTransport and passing two slots
 * nobody's card lives in.
 */

export interface ConformanceTarget {
  adapter: DoorAdapter
  /** Two free slots the suite may write to and clear afterwards. */
  scratchSlots: [number, number]
  /** Off by default: on the real board the event log is somebody's history. */
  mayClearEventLog?: boolean
}

export function runDoorAdapterConformance(
  name: string,
  connect: () => Promise<ConformanceTarget>,
): void {
  describe(`${name} as a door controller`, () => {
    it('reports both doors and the alarm numbers', async () => {
      const { adapter } = await connect()
      const status = await adapter.status()
      expect(typeof status.frontLocked).toBe('boolean')
      expect(typeof status.rearLocked).toBe('boolean')
      expect(Number.isInteger(status.armed)).toBe(true)
      expect(Number.isInteger(status.activated)).toBe(true)
    })

    it('unlocks and locks each door and says so afterwards', async () => {
      const { adapter } = await connect()
      await adapter.setLock('all', true)
      expect(await adapter.status()).toMatchObject({ frontLocked: true, rearLocked: true })

      await adapter.setLock('front', false)
      expect(await adapter.status()).toMatchObject({ frontLocked: false, rearLocked: true })

      await adapter.setLock('all', true)
      expect(await adapter.status()).toMatchObject({ frontLocked: true, rearLocked: true })
    })

    it('pulses a strike without changing the lock state', async () => {
      const { adapter } = await connect()
      await adapter.setLock('all', true)
      await adapter.open('front')
      expect(await adapter.status()).toMatchObject({ frontLocked: true })
    })

    it('arms and disarms the alarm', async () => {
      const { adapter } = await connect()
      await adapter.setAlarm(false)
      expect((await adapter.status()).armed).toBe(0)
      await adapter.setAlarm(true)
      expect((await adapter.status()).armed).toBeGreaterThan(0)
    })

    it('writes a card, reads it back, and clears it', async () => {
      const { adapter, scratchSlots } = await connect()
      const slot = scratchSlots[0]

      await adapter.writeCard(slot, 1, '0001E240')
      expect(await adapter.readCard(slot)).toEqual({
        slot,
        cardNumber: '0001E240',
        permissions: 1,
      })
      expect(await adapter.readCardTable()).toContainEqual({
        slot,
        cardNumber: '0001E240',
        permissions: 1,
      })

      await adapter.clearCard(slot)
      expect(await adapter.readCard(slot)).toBeNull()
    })

    it('stores a short card number in the padded eight character form', async () => {
      const { adapter, scratchSlots } = await connect()
      const slot = scratchSlots[1]

      await adapter.writeCard(slot, 255, '1E240')
      expect(await adapter.readCard(slot)).toEqual({
        slot,
        cardNumber: '0001E240',
        permissions: 255,
      })
      await adapter.clearCard(slot)
    })

    it('writes the same card twice without changing anything the second time', async () => {
      const { adapter, scratchSlots } = await connect()
      const slot = scratchSlots[0]

      await adapter.writeCard(slot, 1, '0001E240')
      const first = await adapter.readCardTable()
      await adapter.writeCard(slot, 1, '0001E240')
      expect(await adapter.readCardTable()).toEqual(first)

      await adapter.clearCard(slot)
    })

    it('keeps every other slot alone when one is cleared', async () => {
      const { adapter, scratchSlots } = await connect()
      const [first, second] = scratchSlots

      await adapter.writeCard(first, 1, '0001E240')
      await adapter.writeCard(second, 1, '00ABCDEF')
      await adapter.clearCard(first)

      expect(await adapter.readCard(first)).toBeNull()
      expect(await adapter.readCard(second)).toMatchObject({ cardNumber: '00ABCDEF' })
      await adapter.clearCard(second)
    })

    it('reads the event log as entries', async () => {
      const target = await connect()
      const entries = await target.adapter.readLog()
      expect(Array.isArray(entries)).toBe(true)
      for (const entry of entries) expect(typeof entry.key).toBe('string')

      if (target.mayClearEventLog !== true) return
      await target.adapter.clearLog()
      expect(await target.adapter.readLog()).toEqual([])
    })
  })
}
