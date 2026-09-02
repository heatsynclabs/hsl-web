import { describe, expect, it } from 'vitest'

import { memberLevelLabel, paymentStatus } from './members.ts'

describe('memberLevelLabel', () => {
  it('labels every level present in production', () => {
    expect(memberLevelLabel(0)).toBe('None')
    expect(memberLevelLabel(1)).toBe('Unable')
    expect(memberLevelLabel(10)).toBe('Volunteer')
    expect(memberLevelLabel(25)).toBe('Associate ($25)')
    expect(memberLevelLabel(50)).toBe('Basic ($50)')
    expect(memberLevelLabel(100)).toBe('Plus ($100)')
  })

  it('puts each band boundary on the right side', () => {
    expect(memberLevelLabel(24)).toBe('Volunteer')
    expect(memberLevelLabel(25)).toBe('Associate ($25)')
    expect(memberLevelLabel(49)).toBe('Associate ($25)')
    expect(memberLevelLabel(50)).toBe('Basic ($50)')
    expect(memberLevelLabel(99)).toBe('Basic ($50)')
    expect(memberLevelLabel(100)).toBe('Plus ($100)')
    expect(memberLevelLabel(999)).toBe('Plus ($100)')
  })

  it('has no label for a member whose level was never recorded', () => {
    expect(memberLevelLabel(null)).toBeNull()
  })

  it('has no label in the gaps and above the top band, as Rails has none', () => {
    expect(memberLevelLabel(2)).toBeNull()
    expect(memberLevelLabel(9)).toBeNull()
    expect(memberLevelLabel(1000)).toBeNull()
    expect(memberLevelLabel(-1)).toBeNull()
  })
})

describe('paymentStatus', () => {
  const now = new Date('2026-09-01T12:00:00Z')
  const daysBefore = (days: number) =>
    new Date(now.getTime() - days * 24 * 60 * 60 * 1000)

  it('is paid when the most recent payment is inside the 60 day window', () => {
    expect(paymentStatus(50, daysBefore(30), now)).toBe('paid')
  })

  it('is paid on the 60th day and lapsed on the 61st', () => {
    expect(paymentStatus(50, daysBefore(60), now)).toBe('paid')
    expect(paymentStatus(50, daysBefore(61), now)).toBe('lapsed')
  })

  it('is lapsed when a dues paying member has never paid', () => {
    expect(paymentStatus(25, null, now)).toBe('lapsed')
  })

  it('does not apply below the lowest dues tier', () => {
    expect(paymentStatus(10, null, now)).toBe('not-applicable')
    expect(paymentStatus(10, daysBefore(400), now)).toBe('not-applicable')
    expect(paymentStatus(0, daysBefore(400), now)).toBe('not-applicable')
    expect(paymentStatus(1, daysBefore(400), now)).toBe('not-applicable')
  })

  it('does not apply when the member has no level recorded', () => {
    expect(paymentStatus(null, daysBefore(1), now)).toBe('not-applicable')
  })

  it('applies across the whole dues range and stops above it', () => {
    expect(paymentStatus(25, daysBefore(1), now)).toBe('paid')
    expect(paymentStatus(999, daysBefore(1), now)).toBe('paid')
    expect(paymentStatus(1000, daysBefore(1), now)).toBe('not-applicable')
  })
})
