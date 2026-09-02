import { describe, expect, it } from 'vitest'

import { parseStatus } from './status.ts'

/** The payload recorded in docs/legacy-system.md, character for character. */
const LOCKED =
  '{"armed":255,"activated":255,"alarm_3":1,"alarm_2":1,"door_1_locked":1,"door_2_locked":1}'

describe('reading the controller status', () => {
  it('reads the payload the firmware sends', () => {
    expect(parseStatus(LOCKED)).toEqual({
      frontLocked: true,
      rearLocked: true,
      armed: 255,
      activated: 255,
      alarm2: 1,
      alarm3: 1,
    })
  })

  it('reads 0 as unlocked, which is what door_1_locked means', () => {
    const open = LOCKED.replace('"door_1_locked":1', '"door_1_locked":0')
    expect(parseStatus(open).frontLocked).toBe(false)
    expect(parseStatus(open).rearLocked).toBe(true)
  })

  it('keeps door_2 as the rear door, matching the o2 command', () => {
    const rearOpen = LOCKED.replace('"door_2_locked":1', '"door_2_locked":0')
    expect(parseStatus(rearOpen).rearLocked).toBe(false)
    expect(parseStatus(rearOpen).frontLocked).toBe(true)
  })

  it('says what the controller answered instead when the answer is not a status', () => {
    expect(() => parseStatus('priv mode disabled')).toThrow(/priv mode disabled/)
    expect(() => parseStatus('')).toThrow(/not a status document/)
  })
})
