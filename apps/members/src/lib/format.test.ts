import { describe, expect, it } from 'vitest'

import { formatDay, formatTimeOfDay } from './format'

describe('formatDay', () => {
  it('keeps a calendar date on its own day west of UTC', () => {
    // payments.paidOn carries no time zone. Read in Arizona, seven hours behind,
    // a value formatted in the local zone prints the day before.
    const printed = formatDay('2026-08-12')

    expect(printed).toContain('12')
    expect(printed).not.toContain('11')
  })

  it('hands back what it was given rather than printing Invalid Date', () => {
    expect(formatDay('not a date')).toBe('not a date')
  })
})

describe('formatTimeOfDay', () => {
  it('hands back what it was given rather than printing Invalid Date', () => {
    expect(formatTimeOfDay('')).toBe('')
  })
})
