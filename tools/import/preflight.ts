import type {
  LegacyCard,
  LegacyContract,
  LegacyPayment,
  LegacySnapshot,
  LegacyUser,
  LegacyUserCertification,
} from './legacy.ts'
import { amountToCents, canonicalCardNumber, canonicalEmail } from './transform.ts'

/**
 * What the import refuses to run on, and what it wants the operator to see
 * before it runs. Every check reads the snapshot and nothing else, so the whole
 * of it is testable without a database.
 *
 * A refusal stops the import. A notice is printed and the import continues.
 * Orphan rows are refusals the operator can accept with --accept-orphans, after
 * reading the list, because the legacy database has no foreign key constraints
 * anywhere and production genuinely holds 67 of them.
 */

export type Severity = 'refusal' | 'notice'

export interface Finding {
  severity: Severity
  check: string
  detail: string
  rows: number
  /** A refusal that --accept-orphans downgrades to a notice. */
  orphan: boolean
}

interface CheckResult {
  severity: Severity
  check: string
  ids: number[]
  detail: string
  orphan?: boolean
}

// EEPROM user slot ceiling, Open_Access_Control firmware. addUser accepts it,
// checkUser never reads it, and production holds exactly one card there.
const HIGHEST_WRITABLE_SLOT = 200
const HIGHEST_READABLE_SLOT = 199

// Devise wrote $2a$. bcryptjs also reads the $2b$ and $2y$ variants.
const KNOWN_HASH_PREFIXES = ['$2a$', '$2b$', '$2y$']

const SAMPLE_SIZE = 10

function report(result: CheckResult): Finding[] {
  if (result.ids.length === 0) return []

  const sample = result.ids.slice(0, SAMPLE_SIZE).join(', ')
  const rest = result.ids.length - SAMPLE_SIZE
  const more = rest > 0 ? `, and ${rest} more` : ''

  return [
    {
      severity: result.severity,
      check: result.check,
      detail: `${result.detail} Legacy ids: ${sample}${more}.`,
      rows: result.ids.length,
      orphan: result.orphan ?? false,
    },
  ]
}

function duplicates<Key>(pairs: ReadonlyArray<{ id: number; key: Key }>): number[] {
  const seen = new Map<Key, number[]>()

  for (const pair of pairs) {
    const ids = seen.get(pair.key)
    if (ids === undefined) seen.set(pair.key, [pair.id])
    else ids.push(pair.id)
  }

  const clashing: number[] = []
  for (const ids of seen.values()) {
    if (ids.length > 1) clashing.push(...ids)
  }

  return clashing.sort((a, b) => a - b)
}

function blank(value: string | null): boolean {
  return value === null || value.trim() === ''
}

function checkUsers(users: LegacyUser[]): Finding[] {
  const ids = new Set(users.map((row) => row.id))
  const known = (pointer: number | null) => pointer === null || ids.has(pointer)
  const badHash = (row: LegacyUser) =>
    !blank(row.encryptedPassword) &&
    !KNOWN_HASH_PREFIXES.some((prefix) => (row.encryptedPassword ?? '').startsWith(prefix))

  return [
    ...report({
      severity: 'refusal',
      check: 'blank email',
      ids: users.filter((row) => blank(row.email)).map((row) => row.id),
      detail: 'A member with no email address cannot sign in and cannot be reconciled.',
    }),
    ...report({
      severity: 'refusal',
      check: 'duplicate email',
      ids: duplicates(users.map((row) => ({ id: row.id, key: canonicalEmail(row.email ?? '') }))),
      detail: 'Two members share an address. Merge them in the legacy system first.',
    }),
    ...report({
      severity: 'refusal',
      check: 'blank name',
      ids: users.filter((row) => blank(row.name)).map((row) => row.id),
      detail: 'The members database has no name to show for this row.',
    }),
    ...report({
      severity: 'refusal',
      check: 'unexpected password hash',
      ids: users.filter(badHash).map((row) => row.id),
      detail: `A hash that does not begin with ${KNOWN_HASH_PREFIXES.join(', ')} will not verify.`,
    }),
    ...report({
      severity: 'notice',
      check: 'no password set',
      ids: users.filter((row) => blank(row.encryptedPassword)).map((row) => row.id),
      detail: 'These members get a member row and no credential, as they had before.',
    }),
    ...report({
      severity: 'notice',
      check: 'email is not lowercase',
      ids: users.filter((row) => row.email !== canonicalEmail(row.email ?? '')).map((r) => r.id),
      detail: 'Sign-in compares lowercased, so the import lowercases these.',
    }),
    ...report({
      severity: 'notice',
      check: 'oriented by an unknown member',
      ids: users.filter((row) => !known(row.orientedById)).map((row) => row.id),
      detail: 'The pointer is dropped and the orientation date is kept.',
    }),
  ]
}

function checkCards(cards: LegacyCard[], userIds: Set<number>): Finding[] {
  const unreadable = (row: LegacyCard) =>
    row.cardNumber === null || !canonical(row.cardNumber).ok
  const canonicalNumbers = cards
    .filter((row) => !unreadable(row))
    .map((row) => ({ id: row.id, key: canonicalCardNumber(row.cardNumber) }))

  return [
    ...report({
      severity: 'refusal',
      check: 'card number is not eight hex characters or fewer',
      ids: cards.filter(unreadable).map((row) => row.id),
      detail: 'The controller stores eight hex characters and nothing else.',
    }),
    ...report({
      severity: 'refusal',
      check: 'duplicate card number',
      ids: duplicates(canonicalNumbers),
      detail: 'Two slots hold the same padded number. The reader would match one of them.',
    }),
    ...report({
      severity: 'refusal',
      check: 'orphan card',
      ids: cards.filter((row) => row.userId === null || !userIds.has(row.userId)).map((r) => r.id),
      detail: 'A card belonging to nobody. This is door access and it is never skipped.',
    }),
    ...report({
      severity: 'refusal',
      check: 'no permission mask',
      ids: cards.filter((row) => row.permissions === null).map((row) => row.id),
      detail: 'Without a mask there is no way to say whether this card opens the door.',
    }),
    ...report({
      severity: 'refusal',
      check: 'card slot outside the EEPROM table',
      ids: cards.filter((row) => row.id < 0 || row.id > HIGHEST_WRITABLE_SLOT).map((r) => r.id),
      detail: `The controller has slots 0 through ${HIGHEST_WRITABLE_SLOT} and this is not one.`,
    }),
    ...report({
      severity: 'notice',
      check: 'card slot the reader cannot see',
      ids: cards
        .filter((row) => row.id > HIGHEST_READABLE_SLOT && row.id <= HIGHEST_WRITABLE_SLOT)
        .map((row) => row.id),
      detail:
        `checkUser stops at slot ${HIGHEST_READABLE_SLOT}, so this card does not open the door ` +
        'today even though the members database says it does. The import keeps the slot exactly ' +
        'as it is. Moving the card to a free slot below 200 is a decision for the operator, ' +
        'taken against the live controller with ?a, not something this script does.',
    }),
  ]
}

function canonical(cardNumber: string): { ok: boolean } {
  try {
    canonicalCardNumber(cardNumber)
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

function checkCertifications(snapshot: LegacySnapshot, userIds: Set<number>): Finding[] {
  const { certifications, userCertifications } = snapshot
  const certificationIds = new Set(certifications.map((row) => row.id))
  const orphan = (row: LegacyUserCertification) =>
    row.userId === null ||
    !userIds.has(row.userId) ||
    row.certificationId === null ||
    !certificationIds.has(row.certificationId)

  return [
    ...report({
      severity: 'refusal',
      check: 'certification without a slug',
      ids: certifications.filter((row) => blank(row.slug) || blank(row.name)).map((r) => r.id),
      detail: 'The interlocks ask for a tool by slug, so a slug and a name are both required.',
    }),
    ...report({
      severity: 'refusal',
      check: 'duplicate certification slug',
      ids: duplicates(certifications.map((row) => ({ id: row.id, key: row.slug ?? '' }))),
      detail: 'Two tools would answer to the same name.',
    }),
    ...report({
      severity: 'refusal',
      check: 'orphan certification grant',
      ids: userCertifications.filter(orphan).map((row) => row.id),
      detail: 'The member or the tool no longer exists. Accepting orphans skips these rows.',
      orphan: true,
    }),
    ...report({
      severity: 'notice',
      check: 'certification granted by an unknown member',
      ids: userCertifications
        .filter((row) => row.createdBy !== null && !userIds.has(row.createdBy))
        .map((row) => row.id),
      detail: 'The grant is kept and the grantor is recorded as unknown.',
    }),
  ]
}

function checkPayments(payments: LegacyPayment[], userIds: Set<number>): Finding[] {
  const unconvertible = (row: LegacyPayment) => {
    try {
      amountToCents(row.amount)
      return false
    } catch {
      return true
    }
  }

  return [
    ...report({
      severity: 'refusal',
      check: 'payment amount that will not convert to cents',
      ids: payments.filter(unconvertible).map((row) => row.id),
      detail: 'legacy payments.amount is an unconstrained numeric and this value is not money.',
    }),
    ...report({
      severity: 'refusal',
      check: 'orphan payment',
      ids: payments
        .filter((row) => row.userId === null || !userIds.has(row.userId))
        .map((row) => row.id),
      detail: 'A payment belonging to nobody. Accepting orphans skips these rows.',
      orphan: true,
    }),
    ...report({
      severity: 'refusal',
      check: 'payment with no date',
      ids: payments.filter((row) => row.paidOn === null).map((row) => row.id),
      detail: 'Dues status is derived from the most recent payment date. Accepting orphans skips these.',
      orphan: true,
    }),
    ...report({
      severity: 'notice',
      check: 'payment with no amount',
      ids: payments.filter((row) => row.amount === null).map((row) => row.id),
      detail: 'Recorded as zero cents with a note saying the legacy row held no amount.',
    }),
    ...report({
      severity: 'notice',
      check: 'payment recorded by an unknown member',
      ids: payments
        .filter((row) => row.createdBy !== null && !userIds.has(row.createdBy))
        .map((row) => row.id),
      detail: 'The payment is kept and the recorder is dropped.',
    }),
  ]
}

function checkContracts(contracts: LegacyContract[], userIds: Set<number>): Finding[] {
  return [
    ...report({
      severity: 'refusal',
      check: 'orphan signed release',
      ids: contracts
        .filter((row) => row.userId === null || !userIds.has(row.userId))
        .map((row) => row.id),
      detail:
        'A signed release belonging to nobody. It stays in the legacy database, which the ' +
        'runbook keeps restorable. Accepting orphans skips these rows.',
      orphan: true,
    }),
    ...report({
      severity: 'notice',
      check: 'release with no signing date',
      ids: contracts.filter((row) => row.signedAt === null).map((row) => row.id),
      detail: 'The row creation date is used instead.',
    }),
    ...report({
      severity: 'notice',
      check: 'release with no stored document',
      ids: contracts.filter((row) => blank(row.documentFileName)).map((row) => row.id),
      detail: 'The waiver row records that the document is missing rather than naming one.',
    }),
  ]
}

export function preflight(snapshot: LegacySnapshot): Finding[] {
  const userIds = new Set(snapshot.users.map((row) => row.id))

  return [
    ...checkUsers(snapshot.users),
    ...checkCards(snapshot.cards, userIds),
    ...checkCertifications(snapshot, userIds),
    ...checkPayments(snapshot.payments, userIds),
    ...checkContracts(snapshot.contracts, userIds),
  ]
}

/** The findings that stop the import, given whether the operator accepted orphans. */
export function refusals(findings: Finding[], acceptOrphans: boolean): Finding[] {
  return findings.filter(
    (finding) => finding.severity === 'refusal' && !(finding.orphan && acceptOrphans),
  )
}

export function formatFindings(findings: Finding[], acceptOrphans: boolean): string {
  if (findings.length === 0) return 'Preflight found nothing to report.'

  const stopping = new Set(refusals(findings, acceptOrphans))
  const lines = findings.map((finding) => {
    const label = stopping.has(finding) ? 'REFUSAL' : finding.orphan ? 'ACCEPTED' : 'NOTICE'
    return `  ${label.padEnd(8)} ${finding.check} (${finding.rows})\n           ${finding.detail}`
  })

  return `Preflight:\n${lines.join('\n')}`
}
