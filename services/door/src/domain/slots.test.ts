import { CARD_SLOT_COUNT, LAST_USABLE_CARD_SLOT } from '@hsl/schema'
import { describe, expect, it } from 'vitest'

import { isUsableSlot, slotRefusal } from './slots.ts'

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
