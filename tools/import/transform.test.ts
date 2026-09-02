import { describe, expect, it } from 'vitest'

import {
  amountToCents,
  canonicalCardNumber,
  canonicalEmail,
  generateMemberId,
  membersWithCardAccess,
} from './transform.ts'

describe('canonicalCardNumber', () => {
  it('pads a five character number the way Card#upload_to_door did', () => {
    expect(canonicalCardNumber('abcde')).toBe('000ABCDE')
  })

  it('leaves an eight character number alone apart from case', () => {
    expect(canonicalCardNumber('a1b2c3d4')).toBe('A1B2C3D4')
  })

  it('refuses a number that is not hex rather than writing it to a slot', () => {
    expect(() => canonicalCardNumber('not hex')).toThrow(/not hex/)
  })

  it('refuses a number wider than the controller stores', () => {
    expect(() => canonicalCardNumber('0123456789')).toThrow(/wider/)
  })
})

describe('amountToCents', () => {
  it('converts a one place decimal', () => {
    expect(amountToCents('50.0')).toBe(5000)
  })

  it('converts a two place decimal', () => {
    expect(amountToCents('25.00')).toBe(2500)
  })

  it('converts a whole number', () => {
    expect(amountToCents('100')).toBe(10000)
  })

  it('does not round money through a float', () => {
    expect(amountToCents('0.07')).toBe(7)
    expect(amountToCents('1.15')).toBe(115)
  })

  it('records a missing amount as zero', () => {
    expect(amountToCents(null)).toBe(0)
  })

  it('refuses fractional cents', () => {
    expect(() => amountToCents('1.005')).toThrow(/fractional/)
  })
})

describe('membersWithCardAccess', () => {
  it('counts a permission of exactly 1 and nothing else', () => {
    const holders = membersWithCardAccess([
      { userId: 1, permissions: 1 },
      { userId: 2, permissions: 255 },
      { userId: 3, permissions: 0 },
      { userId: null, permissions: 1 },
    ])

    expect([...holders]).toEqual([1])
  })
})

describe('canonicalEmail', () => {
  it('lowercases, because sign-in looks a member up lowercased', () => {
    expect(canonicalEmail(' Rivet@Example.Invalid ')).toBe('rivet@example.invalid')
  })
})

describe('generateMemberId', () => {
  it('has the shape better-auth generates', () => {
    expect(generateMemberId()).toMatch(/^[a-zA-Z0-9]{32}$/)
  })

  it('does not repeat itself', () => {
    const ids = new Set(Array.from({ length: 500 }, generateMemberId))
    expect(ids.size).toBe(500)
  })
})
