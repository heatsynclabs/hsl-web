import type { LegacySnapshot, LegacyUser } from './legacy.ts'
import type { Client } from './pg.ts'
import {
  amountToCents,
  canonicalCardNumber,
  canonicalEmail,
  generateMemberId,
  membersWithCardAccess,
} from './transform.ts'

/**
 * Writing the snapshot into the new schema. Everything here runs inside the
 * transaction the caller opened, and nothing here commits: a half imported
 * members database is worse than none.
 *
 * seedfromold.js in temporary-hsl-infra reads the same six tables and is the
 * source of the query shape. It passes async callbacks to lodash forEach, which
 * never awaits them, so the process can exit with the writes still in flight.
 * Every write below is awaited in order. See ATTRIBUTIONS.md.
 */

// One insert carries at most this many bind parameters, well under the 65,535
// a Postgres extended-protocol message allows.
const MAX_BIND_PARAMETERS = 60000

export interface LoadResult {
  memberIdByLegacyId: Map<number, string>
  written: Record<string, number>
  skipped: Record<string, number>
}

export async function insertRows(
  target: Client,
  table: string,
  columns: readonly string[],
  rows: readonly unknown[][],
): Promise<number> {
  if (rows.length === 0) return 0

  const names = columns.map((column) => `"${column}"`).join(', ')
  const perInsert = Math.max(1, Math.floor(MAX_BIND_PARAMETERS / columns.length))
  let written = 0

  for (let start = 0; start < rows.length; start += perInsert) {
    const values: unknown[] = []
    const tuples = rows.slice(start, start + perInsert).map((row) => {
      const placeholders = row.map((value) => {
        values.push(value)
        return `$${values.length}`
      })
      return `(${placeholders.join(', ')})`
    })

    const sql = `insert into "${table}" (${names}) values ${tuples.join(', ')}`
    written += (await target.query(sql, values)).rowCount ?? 0
  }

  return written
}

const MEMBER_COLUMNS = [
  'id', 'name', 'email', 'email_verified', 'created_at', 'updated_at', 'phone',
  'postal_code', 'emergency_name', 'emergency_phone', 'emergency_email',
  'member_level', 'waiver', 'orientation', 'hidden', 'email_visible',
  'phone_visible', 'current_skills', 'desired_skills', 'payment_method', 'payee',
  'admin', 'instructor', 'accountant', 'card_access', 'legacy_id',
] as const

/**
 * email_verified is false for everyone. The legacy Devise stack enables
 * :validatable but not :confirmable, so no address in that database was ever
 * confirmed and saying otherwise here would be inventing a fact.
 */
function memberRow(user: LegacyUser, id: string, hasCardAccess: boolean): unknown[] {
  return [
    id, (user.name ?? '').trim(), canonicalEmail(user.email), false,
    user.createdAt, user.updatedAt, user.phone, user.postalCode,
    user.emergencyName, user.emergencyPhone, user.emergencyEmail, user.memberLevel,
    user.waiver, user.orientation, user.hidden ?? false, user.emailVisible ?? false,
    user.phoneVisible ?? false, user.currentSkills, user.desiredSkills,
    user.paymentMethod, user.payee, user.admin ?? false, user.instructor ?? false,
    user.accountant ?? false, hasCardAccess, user.id,
  ]
}

/**
 * The sign-in handler in better-auth 1.7.2 finds the credential with
 * providerId "credential", issuer local:credential and accountId equal to the
 * member's own id, all three together. Read from
 * dist/api/routes/sign-in.mjs line 320 and
 * @better-auth/core/src/db/schema/account.ts. Getting issuer wrong returns
 * INVALID_EMAIL_OR_PASSWORD for every member with nothing in the log but a
 * "User not found" warning.
 */
const CREDENTIAL_PROVIDER_ID = 'credential'
const CREDENTIAL_ISSUER = 'local:credential'

const ACCOUNT_COLUMNS = [
  'id', 'user_id', 'provider_id', 'issuer', 'account_id', 'password',
  'created_at', 'updated_at',
] as const

async function loadMembers(target: Client, snapshot: LegacySnapshot): Promise<Map<number, string>> {
  const cardAccess = membersWithCardAccess(
    snapshot.cards.map((card) => ({ userId: card.userId, permissions: card.permissions })),
  )
  const memberIdByLegacyId = new Map<number, string>()
  const members: unknown[][] = []
  const accounts: unknown[][] = []

  for (const user of snapshot.users) {
    const id = generateMemberId()
    memberIdByLegacyId.set(user.id, id)
    members.push(memberRow(user, id, cardAccess.has(user.id)))

    const hash = (user.encryptedPassword ?? '').trim()
    if (hash !== '') {
      accounts.push([
        generateMemberId(), id, CREDENTIAL_PROVIDER_ID, CREDENTIAL_ISSUER, id, hash,
        user.createdAt, user.updatedAt,
      ])
    }
  }

  await insertRows(target, 'user', MEMBER_COLUMNS, members)
  await insertRows(target, 'account', ACCOUNT_COLUMNS, accounts)
  await linkOrientedBy(target, snapshot, memberIdByLegacyId)

  return memberIdByLegacyId
}

/** A second pass, because oriented_by_id points at a member row that has to exist first. */
async function linkOrientedBy(
  target: Client,
  snapshot: LegacySnapshot,
  ids: Map<number, string>,
): Promise<void> {
  for (const user of snapshot.users) {
    const orientedBy = user.orientedById === null ? undefined : ids.get(user.orientedById)
    if (orientedBy === undefined) continue

    await target.query('update "user" set oriented_by_id = $1 where id = $2', [
      orientedBy,
      ids.get(user.id),
    ])
  }
}

/**
 * cards.id is the EEPROM slot and is written exactly as it was read. The check
 * afterwards is the point of the whole script: renumbering hands a member
 * someone else's door permission and nothing downstream would notice.
 */
async function loadCards(target: Client, snapshot: LegacySnapshot, ids: Map<number, string>) {
  const rows = snapshot.cards.map((card) => [
    card.id,
    canonicalCardNumber(card.cardNumber),
    ids.get(card.userId as number),
    card.label,
    card.permissions,
    true,
  ])

  const written = await insertRows(
    target,
    'cards',
    ['id', 'card_number', 'user_id', 'label', 'permissions', 'active'],
    rows,
  )

  await verifySlots(target, snapshot)
  return written
}

async function verifySlots(target: Client, snapshot: LegacySnapshot): Promise<void> {
  const stored = await target.query<{ id: number }>('select id from cards order by id')
  const before = snapshot.cards.map((card) => card.id).sort((a, b) => a - b)
  const after = stored.rows.map((row) => row.id)

  if (before.length !== after.length || before.some((slot, index) => slot !== after[index])) {
    throw new Error(
      `Card slots changed during the import. Read ${before.join(', ')} and wrote ${after.join(', ')}. ` +
        'Nothing was committed. Do not run this again until the cause is understood, because a ' +
        'renumbered slot silently gives a member the wrong door permission.',
    )
  }
}

/**
 * Certification ids are preserved so an interlock that already names one keeps
 * naming the same tool. The identity sequence is moved past them afterwards, or
 * the next certification an instructor adds collides with an imported id.
 */
async function loadCertifications(target: Client, snapshot: LegacySnapshot): Promise<number> {
  const rows = snapshot.certifications.map((row) => [row.id, row.slug, row.name, row.description])
  const written = await insertRows(target, 'certifications', ['id', 'slug', 'name', 'description'], rows)

  const highest = snapshot.certifications.reduce((top, row) => Math.max(top, row.id), 0)
  await target.query(`alter table certifications alter column id restart with ${highest + 1}`)

  return written
}


interface Counted {
  written: number
  skipped: number
}

async function loadGrants(
  target: Client,
  snapshot: LegacySnapshot,
  ids: Map<number, string>,
): Promise<Counted> {
  const certificationIds = new Set(snapshot.certifications.map((row) => row.id))
  const carried = snapshot.userCertifications.filter(
    (row) =>
      row.userId !== null &&
      ids.has(row.userId) &&
      row.certificationId !== null &&
      certificationIds.has(row.certificationId),
  )

  const rows = carried.map((row) => [
    ids.get(row.userId as number),
    row.certificationId,
    row.createdBy === null ? null : (ids.get(row.createdBy) ?? null),
    row.createdAt,
  ])

  const written = await insertRows(
    target,
    'user_certifications',
    ['user_id', 'certification_id', 'granted_by_id', 'granted_at'],
    rows,
  )

  return { written, skipped: snapshot.userCertifications.length - carried.length }
}

/** Recorded as zero cents so the payment still counts as a dues event on the date it happened. */
const NO_AMOUNT_NOTE = 'The legacy database recorded no amount for this payment.'

async function loadPayments(
  target: Client,
  snapshot: LegacySnapshot,
  ids: Map<number, string>,
): Promise<Counted> {
  const carried = snapshot.payments.filter(
    (row) => row.userId !== null && ids.has(row.userId) && row.paidOn !== null,
  )

  const rows = carried.map((row) => [
    ids.get(row.userId as number),
    amountToCents(row.amount),
    row.paidOn,
    row.amount === null ? NO_AMOUNT_NOTE : null,
    row.createdBy === null ? null : (ids.get(row.createdBy) ?? null),
    row.createdAt,
  ])

  const written = await insertRows(
    target,
    'payments',
    ['user_id', 'amount_cents', 'paid_on', 'note', 'recorded_by_id', 'created_at'],
    rows,
  )

  return { written, skipped: snapshot.payments.length - carried.length }
}

/**
 * A legacy contract is a signed liability release, which this schema calls a
 * waiver. ADR 0010 carries it as a pointer to the stored document rather than a
 * copy, so document_ref holds the Paperclip file name the old system stored.
 */
function documentRef(fileName: string | null, legacyId: number): string {
  const trimmed = (fileName ?? '').trim()
  return trimmed === '' ? `legacy-contract-${legacyId}-no-document-on-file` : trimmed
}

async function loadWaivers(
  target: Client,
  snapshot: LegacySnapshot,
  ids: Map<number, string>,
): Promise<Counted> {
  const carried = snapshot.contracts.filter(
    (row) => row.userId !== null && ids.has(row.userId),
  )

  const rows = carried.map((row) => [
    ids.get(row.userId as number),
    row.signedAt ?? row.createdAt,
    documentRef(row.documentFileName, row.id),
    row.cosigner,
    row.createdById === null ? null : (ids.get(row.createdById) ?? null),
  ])

  const written = await insertRows(
    target,
    'waivers',
    ['user_id', 'signed_at', 'document_ref', 'cosigner', 'recorded_by_id'],
    rows,
  )

  return { written, skipped: snapshot.contracts.length - carried.length }
}

/** Every write the import performs, in the order the foreign keys require. */
export async function load(target: Client, snapshot: LegacySnapshot): Promise<LoadResult> {
  const memberIdByLegacyId = await loadMembers(target, snapshot)
  const certifications = await loadCertifications(target, snapshot)
  const cards = await loadCards(target, snapshot, memberIdByLegacyId)
  const grants = await loadGrants(target, snapshot, memberIdByLegacyId)
  const payments = await loadPayments(target, snapshot, memberIdByLegacyId)
  const waivers = await loadWaivers(target, snapshot, memberIdByLegacyId)

  return {
    memberIdByLegacyId,
    written: {
      users: memberIdByLegacyId.size,
      cards,
      certifications,
      user_certifications: grants.written,
      payments: payments.written,
      contracts: waivers.written,
    },
    skipped: {
      users: 0,
      cards: 0,
      certifications: 0,
      user_certifications: grants.skipped,
      payments: payments.skipped,
      contracts: waivers.skipped,
    },
  }
}

export { CREDENTIAL_ISSUER, CREDENTIAL_PROVIDER_ID, NO_AMOUNT_NOTE, documentRef }
