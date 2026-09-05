import { CARD_SLOT_COUNT } from '@hsl/schema'

/** The first EEPROM card slot. Slot n lives at byte 24 + n * 5 on the device. */
export const FIRST_CARD_SLOT = 0

/**
 * Why a card cannot live at this slot, or null when it can.
 *
 * Slot 200 is the one that bites. addUser refuses a slot only when
 * userNum > NUMUSERS, so it writes 200, and checkUser stops scanning at byte
 * 1019, which is slot 199, so it never reads it back. Production holds one card
 * there and the members database believes that member has door access.
 */
export function slotRefusal(slot: number): string | null {
  if (!Number.isInteger(slot) || slot < FIRST_CARD_SLOT) {
    return `slot ${slot} is not an EEPROM address`
  }
  if (slot === CARD_SLOT_COUNT) {
    return (
      'slot 200 is written by addUser and never read by checkUser, so a card there never ' +
      'opens the door. Move it to a free slot below 200.'
    )
  }
  if (slot > CARD_SLOT_COUNT) {
    return `slot ${slot} is past the end of the EEPROM card table, which ends at slot ${CARD_SLOT_COUNT}`
  }
  return null
}

export function isUsableSlot(slot: number): boolean {
  return slotRefusal(slot) === null
}
