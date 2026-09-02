import type { DoorLogEntry } from '@hsl/schema'
import { describe, expect, it } from 'vitest'

import { readCards, unknownCards } from './reads.ts'

/**
 * The encoding under test is the firmware's, so the fixtures are built the way
 * Open_Access_Control_Ethernet.ino builds them rather than by hand:
 *
 *   addToLog(low, tag % 32767)
 *   addToLog(high, tag / 32767)
 */
const DIVISOR = 32767

function logged(key: string, tag: number): DoorLogEntry[] {
  return [
    { key, value: String(tag % DIVISOR) },
    { key: key.toLowerCase(), value: String(Math.floor(tag / DIVISOR)) },
  ]
}

/** 0x0000A1B2, the tag on the card in the mockups. */
const A1B2 = 0xa1b2

describe('reading a card out of the controller log', () => {
  it('puts the two halves back together', () => {
    expect(readCards(logged('D', A1B2))).toEqual([{ cardNumber: '0000A1B2', outcome: 'denied' }])
  })

  it('reads a tag larger than the divisor, where the high half is not zero', () => {
    const tag = 0x00abcdef
    expect(Math.floor(tag / DIVISOR)).toBeGreaterThan(0)

    expect(readCards(logged('D', tag))).toEqual([{ cardNumber: '00ABCDEF', outcome: 'denied' }])
  })

  it('reads the widest tag a Wiegand-26 reader can send without overflowing', () => {
    const widest = 0xffffff
    const high = Math.floor(widest / DIVISOR)

    // The firmware stores the halves in a signed 16 bit int. If this ever
    // exceeded 32767 the log would be lying, and so would this parser.
    expect(high).toBeLessThanOrEqual(32767)
    expect(readCards(logged('D', widest))).toEqual([
      { cardNumber: '00FFFFFF', outcome: 'denied' },
    ])
  })

  it('names the outcome from the log letter', () => {
    expect(readCards(logged('G', A1B2))[0]?.outcome).toBe('granted')
    expect(readCards(logged('D', A1B2))[0]?.outcome).toBe('denied')
    expect(readCards(logged('R', A1B2))[0]?.outcome).toBe('presented')
  })

  it('reads several cards out of one dump, in order', () => {
    const entries = [...logged('D', A1B2), ...logged('G', 0x29), ...logged('D', 0xc4d9)]

    expect(readCards(entries).map((read) => read.cardNumber)).toEqual([
      '0000A1B2',
      '00000029',
      '0000C4D9',
    ])
  })

  it('pads to the eight hex characters the controller is written in', () => {
    // A card written as ?m005&p001&t00000029 has to come back as 00000029, not
    // 29, or the reconcile diff would rewrite it on every pass.
    expect(readCards(logged('D', 0x29))[0]?.cardNumber).toBe('00000029')
  })
})

describe('the ring buffer', () => {
  it('reads a pair that straddles the wrap', () => {
    const [low, high] = logged('D', A1B2)
    // The firmware wrapped between the two halves, so the high half is the
    // first line of the dump and the low half is the last.
    const entries = [high!, { key: 'S', value: '0' }, low!]

    expect(readCards(entries)).toEqual([{ cardNumber: '0000A1B2', outcome: 'denied' }])
  })

  it('skips the empty slots the firmware dumps alongside real ones', () => {
    const entries = [
      { key: '', value: '0' },
      ...logged('D', A1B2),
      { key: '', value: '0' },
    ]

    expect(readCards(entries)).toHaveLength(1)
  })

  it('skips a half with no partner rather than guessing the rest of the tag', () => {
    const entries = [{ key: 'D', value: String(A1B2 % DIVISOR) }, { key: 'S', value: '0' }]

    expect(readCards(entries)).toEqual([])
  })

  it('ignores entries that carry no tag, like a login or a log clear', () => {
    const entries = [
      { key: 'S', value: '0' },
      { key: 'z', value: '0' },
      { key: 'U', value: '1' },
    ]

    expect(readCards(entries)).toEqual([])
  })

  it('ignores a zero tag, which is an empty slot rather than a card', () => {
    expect(readCards(logged('D', 0))).toEqual([])
  })

  it('ignores a negative value rather than producing a nonsense card number', () => {
    const entries = [
      { key: 'D', value: '-5' },
      { key: 'd', value: '-1' },
    ]

    expect(readCards(entries)).toEqual([])
  })

  it('reads nothing out of an empty dump', () => {
    expect(readCards([])).toEqual([])
  })
})

describe('which reads an admin is shown', () => {
  const known = new Set(['0000A1B2'])

  it('leaves out a card the database already holds', () => {
    const reads = readCards([...logged('D', A1B2), ...logged('D', 0xc4d9)])

    expect(unknownCards(reads, known).map((read) => read.cardNumber)).toEqual(['0000C4D9'])
  })

  it('shows one row for a card held to the reader several times', () => {
    const reads = readCards([...logged('D', 0xc4d9), ...logged('D', 0xc4d9)])

    expect(unknownCards(reads, known)).toHaveLength(1)
  })

  it('shows a granted read of a card the database does not know', () => {
    // The controller opened for a card no member row claims. That is the
    // opposite problem and it is worth an admin seeing it.
    const reads = readCards(logged('G', 0xc4d9))

    expect(unknownCards(reads, known)).toEqual([{ cardNumber: '0000C4D9', outcome: 'granted' }])
  })

  it('shows nothing when every read is a card the database holds', () => {
    expect(unknownCards(readCards(logged('G', A1B2)), known)).toEqual([])
  })
})
