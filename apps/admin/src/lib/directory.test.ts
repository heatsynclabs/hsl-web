import { describe, expect, it } from 'vitest'

import { directoryEntries, memberRecord } from '../test-fixtures.ts'
import type { MemberSummary } from './directory.ts'
import { cardText, filterMembers, pageCount, pageOf, summarise, toRow } from './directory.ts'

const noSummaries = new Map<string, MemberSummary>()

function summariesFor(entries: Record<string, MemberSummary>): Map<string, MemberSummary> {
  return new Map(Object.entries(entries))
}

const holdsCard: MemberSummary = {
  activeSlots: [41],
  cardsOnRecord: 1,
  holdsCard: true,
  paymentStatus: 'paid',
}

const cardRevoked: MemberSummary = {
  activeSlots: [],
  cardsOnRecord: 1,
  holdsCard: false,
  paymentStatus: 'lapsed',
}

const neverHeldCard: MemberSummary = {
  activeSlots: [],
  cardsOnRecord: 0,
  holdsCard: false,
  paymentStatus: 'paid',
}

describe('searching the directory', () => {
  it('matches part of a name, whatever the case', () => {
    const found = filterMembers(directoryEntries, { query: 'RIVE', card: 'any' }, noSummaries)

    expect(found.map((entry) => entry.name)).toEqual(['Sam Rivera'])
  })

  it('matches an email address a member chose to show', () => {
    const found = filterMembers(directoryEntries, { query: 'volkov@', card: 'any' }, noSummaries)

    expect(found.map((entry) => entry.name)).toEqual(['M. Volkov'])
  })

  it('cannot match an address the member keeps to themself', () => {
    // J. Tanaka has emailVisible off, so the directory row carries no address.
    const found = filterMembers(directoryEntries, { query: 'tanaka@', card: 'any' }, noSummaries)

    expect(found).toEqual([])
  })
})

describe('filtering by whether a member holds a card', () => {
  const summaries = summariesFor({ mbr_rivera: holdsCard, mbr_volkov: cardRevoked })

  it('keeps only members with an active card', () => {
    const found = filterMembers(directoryEntries, { query: '', card: 'held' }, summaries)

    expect(found.map((entry) => entry.name)).toEqual(['Sam Rivera'])
  })

  it('counts a deactivated card as no card', () => {
    const found = filterMembers(directoryEntries, { query: '', card: 'none' }, summaries)

    expect(found.map((entry) => entry.name)).toEqual(['M. Volkov'])
  })

  it('leaves out members whose record has not been read, rather than guessing', () => {
    const found = filterMembers(directoryEntries, { query: '', card: 'none' }, summaries)

    expect(found.map((entry) => entry.id)).not.toContain('mbr_tanaka')
  })
})

describe('paging a thousand rows', () => {
  const thousand = Array.from({ length: 1061 }, (_, index) => ({
    ...directoryEntries[0]!,
    id: `mbr_${index}`,
  }))

  it('hands a table one page, never the whole directory', () => {
    expect(pageOf(thousand, 1, 25)).toHaveLength(25)
    expect(pageCount(thousand.length, 25)).toBe(43)
  })

  it('gives the last page whatever is left', () => {
    expect(pageOf(thousand, 43, 25)).toHaveLength(11)
  })

  it('counts one page when there is nothing to show', () => {
    expect(pageCount(0, 25)).toBe(1)
  })
})

describe('what the card column says', () => {
  it('prints the slot as the controller writes it, three digits', () => {
    expect(cardText(holdsCard)).toBe('041')
  })

  it('says revoked when a card was deactivated rather than never held', () => {
    expect(cardText(cardRevoked)).toBe('revoked')
  })

  it('says none when the member never had a card', () => {
    expect(cardText(neverHeldCard)).toBe('none')
  })

  it('leaves the cell unknown while the member record has not been read', () => {
    const row = toRow(directoryEntries[0]!, noSummaries)

    expect(row.cardText).toBeNull()
    expect(row.paymentStatus).toBeNull()
  })
})

describe('reading a member record', () => {
  it('takes the slots and the dues status the API worked out', () => {
    expect(summarise(memberRecord)).toEqual({
      activeSlots: [41],
      cardsOnRecord: 1,
      holdsCard: true,
      paymentStatus: 'paid',
    })
  })
})
