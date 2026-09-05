import { describe, expect, it } from 'vitest'

import type { LegacySnapshot } from './legacy.ts'
import { preflight, refusals } from './preflight.ts'

const AT = '2026-01-01T00:00:00.000000Z'
const HASH = '$2a$10$ehoGzKgoN9ojlEWJzDhnJu3tywn13QmNrHbPE0ZK18p18GxgS5mWu'

function member(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Member ${id}`,
    email: `member${id}@example.invalid`,
    encryptedPassword: HASH,
    phone: null,
    postalCode: null,
    emergencyName: null,
    emergencyPhone: null,
    emergencyEmail: null,
    memberLevel: 50,
    waiver: null,
    orientation: null,
    orientedById: null,
    hidden: null,
    emailVisible: null,
    phoneVisible: null,
    currentSkills: null,
    desiredSkills: null,
    paymentMethod: null,
    payee: null,
    admin: null,
    instructor: null,
    accountant: null,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  }
}

function snapshot(overrides: Partial<LegacySnapshot> = {}): LegacySnapshot {
  return {
    users: [member(1)],
    cards: [],
    certifications: [],
    userCertifications: [],
    payments: [],
    contracts: [],
    ...overrides,
  } as LegacySnapshot
}

function checks(findings: ReturnType<typeof preflight>): string[] {
  return findings.map((finding) => finding.check)
}

describe('preflight', () => {
  it('passes a snapshot with nothing wrong in it', () => {
    expect(preflight(snapshot())).toEqual([])
  })

  it('refuses two members sharing an address', () => {
    const found = preflight(
      snapshot({ users: [member(1), member(2, { email: 'MEMBER1@example.invalid' })] }),
    )

    expect(checks(found)).toContain('duplicate email')
    expect(refusals(found, true)).toHaveLength(1)
  })

  it('refuses a password hash it does not recognise', () => {
    const found = preflight(snapshot({ users: [member(1, { encryptedPassword: 'plaintext' })] }))

    expect(checks(found)).toContain('unexpected password hash')
  })

  it('treats a member with no password as a notice, not a refusal', () => {
    const found = preflight(snapshot({ users: [member(1, { encryptedPassword: '' })] }))

    expect(checks(found)).toEqual(['no password set'])
    expect(refusals(found, false)).toEqual([])
  })

  /**
   * The response contract has no maximum, the column is unbounded text and the
   * import copies what Rails held, but patchMeRequest caps the two free text
   * fields. So the import can write a row the profile form cannot resend, and
   * the operator should hear about it before cutover rather than a member
   * discovering it.
   */
  it('reports a skills answer longer than the profile form accepts, without refusing it', () => {
    const users = [member(1, { currentSkills: 'x'.repeat(2001) })]
    const found = preflight(snapshot({ users }))

    expect(checks(found)).toContain('skills answer longer than the profile form accepts')
    expect(refusals(found, false)).toEqual([])
  })

  it('says nothing about a skills answer that fits', () => {
    const users = [member(1, { currentSkills: 'x'.repeat(2000), desiredSkills: 'MIG welding' })]

    expect(checks(preflight(snapshot({ users })))).not.toContain(
      'skills answer longer than the profile form accepts',
    )
  })

  it('reports the card at slot 200 without refusing it', () => {
    const cards = [{ id: 200, cardNumber: 'beef01', permissions: 1, userId: 1, label: null }]
    const found = preflight(snapshot({ cards }))

    expect(checks(found)).toEqual(['card slot the reader cannot see'])
    expect(refusals(found, false)).toEqual([])
  })

  it('refuses a card slot the controller has no room for', () => {
    const cards = [{ id: 201, cardNumber: 'beef01', permissions: 1, userId: 1, label: null }]

    expect(checks(preflight(snapshot({ cards })))).toContain('card slot outside the EEPROM table')
  })

  it('refuses a card number that is not hex', () => {
    const cards = [{ id: 14, cardNumber: 'zzzz', permissions: 1, userId: 1, label: null }]

    expect(refusals(preflight(snapshot({ cards })), true)).toHaveLength(1)
  })

  it('never lets an orphan card through, even when orphans are accepted', () => {
    const cards = [{ id: 14, cardNumber: 'beef01', permissions: 1, userId: 42, label: null }]
    const found = preflight(snapshot({ cards }))

    expect(checks(found)).toContain('orphan card')
    expect(refusals(found, true)).toHaveLength(1)
  })

  /**
   * amount_cents is an integer column, and the legacy amount is an
   * unconstrained numeric. A row past the column's range used to reach the
   * insert and stop the whole import with `value "..." is out of range for type
   * integer`, which names no row out of 8,291.
   */
  it('refuses a payment amount that will not fit in the cents column', () => {
    const payments = [
      {
        id: 1,
        userId: 1,
        amount: '50000000000.00',
        paidOn: '2026-01-01',
        createdBy: null,
        createdAt: AT,
      },
    ]

    expect(checks(preflight(snapshot({ payments })))).toContain(
      'payment amount that will not convert to cents',
    )
    expect(refusals(preflight(snapshot({ payments })), true)).toHaveLength(1)
  })

  it('says nothing about the largest amount that does fit', () => {
    const payments = [
      {
        id: 1,
        userId: 1,
        amount: '21474836.47',
        paidOn: '2026-01-01',
        createdBy: null,
        createdAt: AT,
      },
    ]

    expect(preflight(snapshot({ payments }))).toEqual([])
  })

  /**
   * Section 6 of HANDOFF.md asks whether the legacy database holds a duplicate
   * pair. The import reads every grant on its way past, so it can answer
   * instead of leaving somebody to go and look.
   */
  it('reports a member granted the same certification twice', () => {
    const certifications = [{ id: 1, slug: 'laser', name: 'Laser Cutter', description: null }]
    const userCertifications = [
      { id: 1, userId: 1, certificationId: 1, createdBy: null, createdAt: AT },
      { id: 2, userId: 1, certificationId: 1, createdBy: null, createdAt: AT },
    ]
    const found = preflight(snapshot({ certifications, userCertifications }))

    expect(checks(found)).toContain('the same certification granted twice')
    expect(refusals(found, false)).toEqual([])
  })

  it('lets an orphan release through only when the operator accepts orphans', () => {
    const contracts = [
      {
        id: 1,
        userId: 42,
        signedAt: AT,
        documentFileName: 'release.pdf',
        cosigner: null,
        createdById: null,
        createdAt: AT,
      },
    ]
    const found = preflight(snapshot({ contracts }))

    expect(refusals(found, false)).toHaveLength(1)
    expect(refusals(found, true)).toEqual([])
  })
})
