import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { cardRecord } from './contracts.ts'
import {
  assignableCardSlot,
  cardNumber,
  CARD_SLOT_COUNT,
  LAST_USABLE_CARD_SLOT,
  storedCardSlot,
  syncCard,
} from './door.ts'

const migrationsDir = fileURLToPath(new URL('../migrations', import.meta.url))

describe('card slots', () => {
  it('hands out slots 0 through 199, the range the reader scans', () => {
    expect(assignableCardSlot.parse(0)).toBe(0)
    expect(assignableCardSlot.parse(LAST_USABLE_CARD_SLOT)).toBe(199)
    expect(assignableCardSlot.safeParse(-1).success).toBe(false)
    expect(assignableCardSlot.safeParse(1.5).success).toBe(false)
  })

  it('refuses to hand out slot 200, which the controller writes and never reads', () => {
    expect(assignableCardSlot.safeParse(CARD_SLOT_COUNT).success).toBe(false)
    expect(syncCard.safeParse({ slot: 200, cardNumber: '0000ABCD', permissions: 1 }).success)
      .toBe(false)
  })

  it('accepts the one production card already sitting at slot 200', () => {
    expect(storedCardSlot.parse(200)).toBe(200)
    const parsed = cardRecord.parse({
      slot: 200,
      cardNumber: '00ABCDEF',
      userId: 'member-1',
      label: 'the one at 200',
      permissions: 1,
      active: true,
    })
    expect(parsed.slot).toBe(200)
  })

  it('stops above the EEPROM table', () => {
    expect(storedCardSlot.safeParse(201).success).toBe(false)
  })

  it('never lets the database reject a slot the legacy data holds', () => {
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'))
    expect(files.length).toBeGreaterThan(0)

    const sql = files.map((f) => readFileSync(join(migrationsDir, f), 'utf8')).join('\n')
    const createCards = /CREATE TABLE "cards" \(([\s\S]*?)\);/.exec(sql)
    expect(createCards).not.toBeNull()
    expect(createCards?.[1]).not.toMatch(/CHECK/i)
  })
})

describe('card numbers', () => {
  it('is eight uppercase hex characters, the padded form the controller wants', () => {
    expect(cardNumber.parse('00ABCDEF')).toBe('00ABCDEF')
    expect(cardNumber.parse('12345678')).toBe('12345678')
  })

  it('refuses a short number, because padding happens once at the import', () => {
    expect(cardNumber.safeParse('ABCDEF').success).toBe(false)
    expect(cardNumber.safeParse('123456789').success).toBe(false)
  })

  it('refuses lowercase, so two rows cannot mean the same card', () => {
    expect(cardNumber.safeParse('00abcdef').success).toBe(false)
  })
})

describe('card permissions', () => {
  it('accepts the 255 mask one production card carries', () => {
    const parsed = syncCard.parse({ slot: 14, cardNumber: '0001E240', permissions: 255 })
    expect(parsed.permissions).toBe(255)
  })
})
