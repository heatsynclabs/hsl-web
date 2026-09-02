import { ApiError } from '@hsl/api-client'
import { describe, expect, it } from 'vitest'

import {
  assignRefusalText,
  eventText,
  outcomePill,
  outcomeText,
  slotIsReadable,
  slotListText,
  unreadableSlots,
  unreconciledSlots,
} from './door.ts'
import { cardTableView } from '../test-fixtures.ts'

describe('what the reader did', () => {
  it('says a refusal in words, because that is the ordinary answer to an unissued card', () => {
    expect(outcomeText('denied')).toBe('Refused')
    expect(outcomePill('denied')).toBe('plain')
  })

  it('marks a card the controller let in, because no card row claims it', () => {
    expect(outcomeText('granted')).toBe('Opened the door')
    expect(outcomePill('granted')).toBe('on')
  })

  it('does not invent an outcome the door service did not send', () => {
    expect(outcomeText(undefined)).toBe('The reader logged no outcome')
  })
})

describe('slots the reader cannot see', () => {
  it('reads 199 as the last slot the firmware scans', () => {
    expect(slotIsReadable(199)).toBe(true)
    expect(slotIsReadable(200)).toBe(false)
  })

  it('picks the production card at slot 200 out of the card table', () => {
    expect(unreadableSlots(cardTableView.slots)).toEqual([200])
  })

  it('picks the rows the next pass will clear', () => {
    expect(unreconciledSlots(cardTableView.slots)).toEqual([17])
  })

  it('prints slot numbers padded the way the lab writes them', () => {
    expect(slotListText([7, 200])).toBe('007, 200')
  })
})

describe('reading a door event', () => {
  it('turns a card read into the number and what happened to it', () => {
    const said = eventText({
      id: 1,
      kind: 'card-presented',
      at: '2026-09-01T17:44:00.000Z',
      detail: { cardNumber: '0004B1C7', outcome: 'denied' },
    })

    expect(said).toBe('Card 0004B1C7 was held to a reader. Refused.')
  })

  it('says why a slot was refused rather than printing the record', () => {
    const said = eventText({
      id: 2,
      kind: 'card-slot-refused',
      at: '2026-09-01T17:44:00.000Z',
      detail: { slot: 200, reason: 'above the last slot the reader scans', source: 'database' },
    })

    expect(said).toContain('Slot 200 was refused')
    expect(said).toContain('above the last slot the reader scans')
  })

  it('prints a kind it has never seen with whatever came with it', () => {
    const said = eventText({
      id: 3,
      kind: 'weather-station-read',
      at: '2026-09-01T17:42:00.000Z',
      detail: { celsius: 31 },
    })

    expect(said).toBe('weather-station-read: celsius 31')
  })

  it('prints a kind with no detail as its own name', () => {
    const said = eventText({ id: 4, kind: 'card-table-synced', at: '2026-09-01T17:43:00.000Z', detail: null })

    expect(said).toContain('pushed because an admin asked for it')
  })
})

describe('a refused assignment', () => {
  it('shows the API sentence as it came, rather than matching on its wording', () => {
    // The API is the only thing that knows why it refused, and its refusals
    // already say what to do. Rewriting them here by matching on their wording
    // would break the moment somebody improved a sentence.
    const refused = ApiError.refused({
      method: 'POST',
      path: '/api/cards',
      status: 409,
      body: {
        error:
          'Card 0004B1C7 is already in slot 041, so no slot was taken. It is already issued. Find it in the card table to see who holds it, rather than assigning it again.',
      },
    })

    expect(assignRefusalText(refused)).toBe(
      'Card 0004B1C7 is already in slot 041, so no slot was taken. It is already issued. Find it in the card table to see who holds it, rather than assigning it again.',
    )
  })

  it('leaves a longer API sentence alone too', () => {
    const full = ApiError.refused({
      method: 'POST',
      path: '/api/cards',
      status: 409,
      body: {
        error:
          'Every slot from 0 to 199 holds a card. No card was assigned. Deactivate and remove a card that is out of service, then try again.',
      },
    })

    expect(assignRefusalText(full)).toBe(
      'Every slot from 0 to 199 holds a card. No card was assigned. Deactivate and remove a card that is out of service, then try again.',
    )
  })

  it('falls back to the client sentence when the API sent no words of its own', () => {
    const silent = ApiError.unreachable({ method: 'POST', path: '/api/cards' })

    expect(assignRefusalText(silent)).toContain('got no response at all')
  })
})
