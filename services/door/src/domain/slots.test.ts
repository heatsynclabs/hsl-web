import { CARD_SLOT_COUNT, LAST_USABLE_CARD_SLOT } from '@hsl/schema'
import { describe, expect, it } from 'vitest'

import { isUsableSlot, nextFreeSlot, slotRefusal } from './slots.ts'

describe('handing out a slot', () => {
  it('gives out the lowest slot nothing occupies', () => {
    expect(nextFreeSlot([])).toBe(0)
    expect(nextFreeSlot([0, 1, 2])).toBe(3)
  })

  it('fills a gap left by a card that was cleared', () => {
    const occupied = [0, 1, 3, 4]
    expect(nextFreeSlot(occupied)).toBe(2)
  })

  it('gives out the production slot range, 14 through 199', () => {
    const occupied = Array.from({ length: 199 }, (unused, index) => index)
    expect(nextFreeSlot(occupied)).toBe(LAST_USABLE_CARD_SLOT)
  })

  it('refuses at 200 rather than handing out a slot the reader never scans', () => {
    const full = Array.from({ length: CARD_SLOT_COUNT }, (unused, index) => index)
    expect(() => nextFreeSlot(full)).toThrow(/no card was assigned/)
    expect(() => nextFreeSlot(full)).not.toThrow(/200 is free/)
  })
})

describe('whether a slot can hold a card', () => {
  it('accepts 0 through 199, the range checkUser scans', () => {
    expect(isUsableSlot(0)).toBe(true)
    expect(isUsableSlot(14)).toBe(true)
    expect(isUsableSlot(LAST_USABLE_CARD_SLOT)).toBe(true)
  })

  it('refuses slot 200 and says why, because one production card sits there', () => {
    expect(isUsableSlot(CARD_SLOT_COUNT)).toBe(false)
    expect(slotRefusal(CARD_SLOT_COUNT)).toMatch(/never read by checkUser/)
  })

  it('refuses anything past the card table or below it', () => {
    expect(slotRefusal(201)).toMatch(/past the end/)
    expect(slotRefusal(-1)).toMatch(/not an EEPROM address/)
    expect(slotRefusal(1.5)).toMatch(/not an EEPROM address/)
  })
})
