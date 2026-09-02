import { describe, expect, it } from 'vitest'

import {
  centsFromInput,
  dateInputValue,
  initialsOf,
  isoFromDateInput,
  moneyText,
  padCardNumber,
  slotText,
} from './format.ts'

describe('card numbers', () => {
  it('pads a short number to eight characters the way the controller stores it', () => {
    // Six of the 64 production cards are five characters, seventeen are six.
    expect(padCardNumber('a1b2c')).toBe('000A1B2C')
    expect(padCardNumber('c4d9ef')).toBe('00C4D9EF')
  })

  it('leaves an eight character number alone', () => {
    expect(padCardNumber('0000A1B2')).toBe('0000A1B2')
  })
})

describe('slots', () => {
  it('prints a slot as three digits and never renumbers it', () => {
    expect(slotText(9)).toBe('009')
    expect(slotText(200)).toBe('200')
  })
})

describe('money', () => {
  it('reads dollars a person typed', () => {
    expect(centsFromInput('50')).toBe(5000)
    expect(centsFromInput('$25.50')).toBe(2550)
  })

  it('refuses anything that is not an amount', () => {
    expect(centsFromInput('')).toBeNull()
    expect(centsFromInput('fifty')).toBeNull()
    expect(centsFromInput('0')).toBeNull()
    expect(centsFromInput('12.345')).toBeNull()
  })

  it('prints cents back as dollars', () => {
    expect(moneyText(5000)).toBe('$50.00')
  })
})

describe('dates', () => {
  it('turns a date input into a timestamp and back to the same day', () => {
    const iso = isoFromDateInput('2026-07-14')

    expect(iso).not.toBeNull()
    expect(dateInputValue(iso)).toBe('2026-07-14')
  })

  it('treats an empty date box as no date rather than as today', () => {
    expect(isoFromDateInput('')).toBeNull()
    expect(dateInputValue(null)).toBe('')
  })
})

describe('initials', () => {
  it('takes the first and last word', () => {
    expect(initialsOf('Sam Rivera')).toBe('SR')
    expect(initialsOf('Prince')).toBe('P')
  })
})
