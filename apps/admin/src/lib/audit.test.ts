import { describe, expect, it } from 'vitest'

import { auditEntries } from '../test-fixtures.ts'
import { actionState, detailText, targetText } from './audit.ts'

describe('the action pill', () => {
  it('fills in amber for a change that hands out access', () => {
    expect(actionState('card.assign')).toBe('on')
    expect(actionState('certification.grant')).toBe('on')
  })

  it('fades a change that takes access away or was refused', () => {
    expect(actionState('certification.revoke')).toBe('off')
    expect(actionState('door.control.refused')).toBe('off')
  })

  it('tints anything else rather than inventing a meaning for it', () => {
    expect(actionState('something.nobody.has.written.yet')).toBe('dim')
  })
})

describe('the detail column', () => {
  it('prints a card slot the way the rest of the app does', () => {
    expect(detailText('card.assign', { slot: 42, permissions: 1 })).toBe('slot 042, permissions 1')
  })

  it('prints what a member change was before it changed', () => {
    const entry = auditEntries[1]!

    expect(detailText(entry.action, entry.detail)).toBe('cardAccess true, was false')
  })

  it('prints money as money', () => {
    expect(detailText('payment.record', { amountCents: 5000, paidOn: '2026-08-04' })).toBe(
      'amountCents $50.00, paidOn 2026-08-04',
    )
  })

  it('prints a key it has never seen rather than dropping it', () => {
    expect(detailText('door.control', { command: 'open-front' })).toBe('command open-front')
  })

  it('is empty when the row carried no detail', () => {
    expect(detailText('member.update', null)).toBe('')
  })
})

describe('the target column', () => {
  const names = new Map([['mbr_rivera', 'Sam Rivera']])

  it('names the member when the directory knows them', () => {
    expect(targetText('mbr_rivera', names)).toBe('Sam Rivera')
  })

  it('prints the id for a member the directory leaves out, such as a hidden one', () => {
    expect(targetText('mbr_hidden', names)).toBe('mbr_hidden')
  })

  it('says the system when the row names no target', () => {
    expect(targetText(null, names)).toBe('the system')
  })
})
