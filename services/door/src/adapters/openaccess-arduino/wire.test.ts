import { doorCommand } from '@hsl/schema'
import { describe, expect, it } from 'vitest'

import {
  chained,
  clearSlotParameter,
  CLEAR_LOG_PARAMETER,
  COMMAND_PARAMETERS,
  DUMP_CARD_TABLE_PARAMETER,
  isLoginAccepted,
  isWriteAccepted,
  LOGOUT_PARAMETER,
  padPermissions,
  padSlot,
  padTag,
  parseCardLine,
  parseCardTable,
  parseLog,
  READ_LOG_PARAMETER,
  redactPassword,
  showSlotParameter,
  STATUS_PARAMETER,
  writeCardParameter,
} from './wire.ts'

const PASSWORD = '1234'

/** The command table in docs/legacy-system.md, one row per line. */
const PROTOCOL: Array<[string, string]> = [
  ['open-front', '?o1&e=1234'],
  ['open-rear', '?o2&e=1234'],
  ['unlock', '?u&e=1234'],
  ['unlock-front', '?u=1&e=1234'],
  ['unlock-rear', '?u=2&e=1234'],
  ['lock', '?l&e=1234'],
  ['lock-front', '?l=1&e=1234'],
  ['lock-rear', '?l=2&e=1234'],
  ['arm', '?2&e=1234'],
  ['disarm', '?1&e=1234'],
]

describe('the command table', () => {
  it.each(PROTOCOL)('sends %s as %s', (command, query) => {
    const parsed = doorCommand.parse(command)
    expect(chained(COMMAND_PARAMETERS[parsed], PASSWORD)).toBe(query)
  })

  it('has a parameter for every command in the vocabulary', () => {
    expect(Object.keys(COMMAND_PARAMETERS).sort()).toEqual([...doorCommand.options].sort())
  })

  it('asks for status with ?9', () => {
    expect(chained(STATUS_PARAMETER, PASSWORD)).toBe('?9&e=1234')
  })

  it('dumps the card table with ?a and reads the event log with ?z', () => {
    expect(chained(DUMP_CARD_TABLE_PARAMETER, PASSWORD)).toBe('?a&e=1234')
    expect(chained(READ_LOG_PARAMETER, PASSWORD)).toBe('?z&e=1234')
    expect(chained(CLEAR_LOG_PARAMETER, PASSWORD)).toBe('?y&e=1234')
  })

  it('shows and clears one slot with the slot padded to three digits', () => {
    expect(chained(showSlotParameter(14), PASSWORD)).toBe('?s014&e=1234')
    expect(chained(clearSlotParameter(199), PASSWORD)).toBe('?r199&e=1234')
  })

  it('logs out with ?e=0000', () => {
    expect(`?${LOGOUT_PARAMETER}`).toBe('?e=0000')
  })
})

describe('writing a card', () => {
  it('pads the slot to three, the mask to three and the tag to eight', () => {
    const query = chained(
      writeCardParameter({ slot: 14, permissions: 1, cardNumber: '1E240' }),
      PASSWORD,
    )
    expect(query).toBe('?m014&p001&t0001E240&e=1234')
  })

  it('carries the 255 mask one production card holds', () => {
    expect(writeCardParameter({ slot: 200, permissions: 255, cardNumber: '00ABCDEF' }))
      .toBe('m200&p255&t00ABCDEF')
  })

  it('pads a five, six and seven character card number to eight', () => {
    expect(padTag('1E240')).toBe('0001E240')
    expect(padTag('ABCDEF')).toBe('00ABCDEF')
    expect(padTag('1234567')).toBe('01234567')
    expect(padTag('12345678')).toBe('12345678')
  })

  it('sends the tag in upper case, the form this system stores', () => {
    expect(padTag('00abcdef')).toBe('00ABCDEF')
  })

  it('refuses a card number that is not hex, rather than sending a wrong tag', () => {
    expect(() => padTag('123456789')).toThrow(/hex/)
    expect(() => padTag('ZZZZ')).toThrow(/hex/)
    expect(() => padTag('')).toThrow(/hex/)
  })

  it('refuses a slot the card table does not have and a mask that is not a byte', () => {
    expect(padSlot(0)).toBe('000')
    expect(() => padSlot(201)).toThrow(/card table/)
    expect(() => padSlot(-1)).toThrow(/card table/)
    expect(padPermissions(255)).toBe('255')
    expect(() => padPermissions(256)).toThrow(/byte/)
  })
})

describe('reading the answers', () => {
  it('reads a login by the substring ok and a card write by the substring cur', () => {
    expect(isLoginAccepted('ok')).toBe(true)
    expect(isLoginAccepted('priv mode disabled')).toBe(false)
    expect(isWriteAccepted('cur 014')).toBe(true)
    expect(isWriteAccepted('priv mode disabled')).toBe(false)
  })

  it('reads the event log as key and value', () => {
    expect(parseLog('G: 12345\nR: 999\n\nD: 42\n')).toEqual([
      { key: 'G', value: '12345' },
      { key: 'R', value: '999' },
      { key: 'D', value: '42' },
    ])
  })

  /**
   * The real shape of a ?a body, read from dumpUser at firmware 1545 to 1551:
   * the chained login line, a pre block, a header, then every slot from 0 to
   * 199 as slot, mask and tag separated by tabs and none of them padded.
   */
  it('reads a card table dump and skips whatever frames it', () => {
    const dump = [
      'authok',
      '<pre>',
      'UserNum: Usermask: TagNum:',
      '0\t255\tFFFFFFFF',
      '14\t1\t1E240',
      '15\t255\tFFFFFFFF',
      '199\t255\tABCDEF',
      '</pre>',
      '',
    ].join('\r\n')

    expect(parseCardTable(dump)).toEqual([
      { slot: 14, cardNumber: '0001E240', permissions: 1 },
      { slot: 199, cardNumber: '00ABCDEF', permissions: 255 },
    ])
  })

  /**
   * The board prints all two hundred slots every time. An unwritten one reads
   * back as the erased EEPROM, and checkUser refuses that tag anyway at
   * firmware 1511, so it is not a card here either.
   */
  it('reads an erased slot as no card, whichever way it was erased', () => {
    expect(parseCardLine('14\t255\tFFFFFFFF')).toBeNull()
    expect(parseCardLine('14\t0\t0')).toBeNull()
  })

  it('pads a short tag to the width the rest of this system uses', () => {
    expect(parseCardLine('14\t1\tC8C8')).toEqual({
      slot: 14,
      cardNumber: '0000C8C8',
      permissions: 1,
    })
  })

  it('keeps the carriage return out of the tag, because the board writes CRLF', () => {
    expect(parseCardLine('14\t1\t1E240\r')).toMatchObject({ cardNumber: '0001E240' })
  })
})

describe('the password', () => {
  it('never reaches a log line or an error message', () => {
    expect(redactPassword('?m014&p001&t0001E240&e=1234')).toBe('?m014&p001&t0001E240&e=REDACTED')
    expect(redactPassword('?9&e=1234')).not.toContain('1234')
  })
})
