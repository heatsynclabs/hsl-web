import { randomUUID } from 'node:crypto'

import postgres from 'postgres'

import { placementForLegacyCard } from '../door/src/adapters/openaccess.ts'

/**
 * The one-time import from the legacy Rails database.
 *
 * Run it once, against a read-only restored copy of the production dump, never
 * against the live system. It reports by default and writes only with --apply.
 *
 * Column names come from db/schema.rb in
 * heatsynclabs/Open-Source-Access-Control-Web-Interface at version
 * 20141120200638. See ATTRIBUTIONS.md.
 *
 * ASSUMPTION: the legacy timestamps are stored in UTC.
 * CONFIRM BY: config/application.rb sets config.time_zone to America/Phoenix
 *   and never sets config.active_record.default_timezone, whose Rails 3.2
 *   default is :utc. Confirm against the gem rather than the application.
 * BLAST RADIUS: every waiver, orientation and payment date lands seven hours
 *   away from where it belongs.
 */

const apply = process.argv.includes('--apply')
const controllerId = process.env.CONTROLLER_ID ?? 'openaccess'

const legacyUrl = need('LEGACY_DATABASE_URL')
const targetUrl = need('DATABASE_URL')

function need(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    process.stdout.write(
      `${name} is not set, so nothing ran. Both of them are in\n` +
        'docs/runbooks/import-the-members-database.md, step 2.\n',
    )
    process.exit(1)
  }
  return value
}

// Reading the legacy database --------------------------------------------------

interface LegacyUser {
  id: number
  name: string | null
  email: string
  encryptedPassword: string | null
  phone: string | null
  emergencyName: string | null
  emergencyPhone: string | null
  currentSkills: string | null
  desiredSkills: string | null
  memberLevel: number | null
  orientation: string | null
  hidden: boolean | null
  admin: boolean | null
  instructor: boolean | null
  accountant: boolean | null
  createdAt: string
}

interface LegacyCard {
  id: number
  cardNumber: string | null
  permissions: number | null
  userId: number | null
  label: string | null
}

interface LegacyCert {
  id: number
  slug: string | null
  name: string | null
  description: string | null
}

interface LegacyUserCert {
  id: number
  userId: number | null
  certificationId: number | null
  createdBy: number | null
  createdAt: string
}

interface LegacyPayment {
  id: number
  userId: number | null
  amount: string | null
  paidOn: string | null
  createdBy: number | null
}

interface LegacyContract {
  id: number
  userId: number | null
  signedAt: string | null
  documentFileName: string | null
}

/**
 * to_char rather than a timestamp parse: a naive `timestamp without time zone`
 * arrives in whatever timezone the importing machine happens to be in. The
 * stored value is already UTC wall time, so it is rendered verbatim and
 * labelled rather than converted, which would shift it twice.
 */
const UTC = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`

const legacy = postgres(legacyUrl, { prepare: false })
const target = postgres(targetUrl)

/** Refuses every write for the life of the connection, before any read runs. */
await legacy`set session characteristics as transaction read only`

const users = await legacy<LegacyUser[]>`
  select id, name, email, encrypted_password as "encryptedPassword", phone,
         emergency_name as "emergencyName", emergency_phone as "emergencyPhone",
         current_skills as "currentSkills", desired_skills as "desiredSkills",
         member_level as "memberLevel", hidden, admin, instructor, accountant,
         to_char(orientation, ${legacy.unsafe(UTC)}) as "orientation",
         to_char(created_at, ${legacy.unsafe(UTC)}) as "createdAt"
  from users order by id`

const cards = await legacy<LegacyCard[]>`
  select id, card_number as "cardNumber", card_permissions as "permissions",
         user_id as "userId", name as "label"
  from cards order by id`

const certifications = await legacy<LegacyCert[]>`
  select id, slug, name, description from certifications order by id`

const userCerts = await legacy<LegacyUserCert[]>`
  select id, user_id as "userId", certification_id as "certificationId",
         created_by as "createdBy",
         to_char(created_at, ${legacy.unsafe(UTC)}) as "createdAt"
  from user_certifications order by id`

const payments = await legacy<LegacyPayment[]>`
  select id, user_id as "userId", amount::text as amount,
         to_char("date", 'YYYY-MM-DD') as "paidOn", created_by as "createdBy"
  from payments order by id`

const contracts = await legacy<LegacyContract[]>`
  select id, user_id as "userId", document_file_name as "documentFileName",
         to_char(signed_at, ${legacy.unsafe(UTC)}) as "signedAt"
  from contracts order by id`

// Conversions -------------------------------------------------------------------

/** Card#upload_to_door pads with rjust(8, '0'). Anything else is a different card. */
function cardId(raw: string | null): string {
  const trimmed = (raw ?? '').trim()
  if (!/^[0-9A-Fa-f]{1,8}$/.test(trimmed)) throw new Error(`card number is not hex: ${raw}`)
  return trimmed.toUpperCase().padStart(8, '0')
}

function rolesOf(user: LegacyUser): string[] {
  const roles: string[] = []
  if (user.admin === true) roles.push('admin')
  if (user.instructor === true) roles.push('instructor')
  if (user.accountant === true) roles.push('accountant')
  return roles
}

/**
 * User#card_access_enabled: true when the member holds at least one card with
 * card_permissions of exactly 1. The mask is not a flag field there and is not
 * treated as one here, so the single production card carrying 255 grants its
 * holder nothing.
 */
const doorAccess = new Set(
  cards.filter((card) => card.permissions === 1 && card.userId !== null).map((card) => card.userId),
)

const certSlug = new Map<number, string>()
for (const cert of certifications) {
  certSlug.set(cert.id, (cert.slug ?? cert.name ?? `cert-${cert.id}`).trim().toLowerCase())
}

const memberId = new Map<number, string>()
for (const user of users) memberId.set(user.id, randomUUID())

// Preflight -----------------------------------------------------------------------

const failures: string[] = []
const warnings: string[] = []

const seenEmail = new Map<string, number>()
for (const user of users) {
  const email = user.email.trim().toLowerCase()
  const first = seenEmail.get(email)
  if (first !== undefined) failures.push(`users ${first} and ${user.id} share the email ${email}`)
  seenEmail.set(email, user.id)

  const password = (user.encryptedPassword ?? '').trim()
  if (password !== '' && !password.startsWith('$2a$10$')) {
    failures.push(`user ${user.id} has a password hash this import does not recognise`)
  }
  for (const field of ['currentSkills', 'desiredSkills'] as const) {
    if ((user[field] ?? '').length > 2000) {
      warnings.push(`user ${user.id} has ${field} longer than the 2,000 characters a profile edit accepts`)
    }
  }
}

const seenToken = new Map<string, number>()
for (const card of cards) {
  if (card.userId === null || !memberId.has(card.userId)) {
    failures.push(`card ${card.id} belongs to user ${card.userId}, who is not in users`)
    continue
  }
  let token: string
  try {
    token = cardId(card.cardNumber)
  } catch (error) {
    failures.push(`card ${card.id}: ${String(error)}`)
    continue
  }
  const first = seenToken.get(token)
  if (first !== undefined) failures.push(`cards ${first} and ${card.id} both normalise to ${token}`)
  seenToken.set(token, card.id)
}

const seenPair = new Set<string>()
for (const held of userCerts) {
  const pair = `${held.userId}:${held.certificationId}`
  if (seenPair.has(pair)) warnings.push(`user_certifications ${held.id} repeats a pair already granted`)
  seenPair.add(pair)
}

for (const payment of payments) {
  if (payment.userId === null || !memberId.has(payment.userId)) {
    warnings.push(`payment ${payment.id} belongs to no user that exists, and is left behind`)
  }
}
for (const contract of contracts) {
  if (contract.userId === null || !memberId.has(contract.userId)) {
    warnings.push(`contract ${contract.id} belongs to no user that exists, and is left behind`)
  }
}

// The report ----------------------------------------------------------------------

const counted = {
  members: users.length,
  credentials: cards.length,
  certifications: certifications.length,
  memberCertifications: userCerts.length,
  payments: payments.length,
  waivers: contracts.length,
  withDoorAccess: doorAccess.size,
  withoutPassword: users.filter((user) => (user.encryptedPassword ?? '').trim() === '').length,
}

process.stdout.write(`${JSON.stringify(counted, null, 2)}\n`)
for (const warning of warnings) process.stdout.write(`warning: ${warning}\n`)
for (const failure of failures) process.stdout.write(`FAILURE: ${failure}\n`)

if (failures.length > 0) {
  process.stdout.write(`\n${failures.length} failures. Nothing was written.\n`)
  await Promise.all([legacy.end(), target.end()])
  process.exit(1)
}

if (!apply) {
  process.stdout.write('\nPreflight only. Run it again with --apply to write.\n')
  await Promise.all([legacy.end(), target.end()])
  process.exit(0)
}

// The write -------------------------------------------------------------------------

await target.begin(async (tx) => {
  for (const user of users) {
    const password = (user.encryptedPassword ?? '').trim()
    await tx`
      insert into members (id, email, name, password, roles, oriented, hidden, door_access,
                           member_level, phone, emergency_name, emergency_phone,
                           current_skills, desired_skills, joined_on, legacy_id, created_at)
      values (${memberId.get(user.id) as string}, ${user.email.trim().toLowerCase()},
              ${(user.name ?? user.email).trim()}, ${password === '' ? null : password},
              ${rolesOf(user)}, ${user.orientation !== null}, ${user.hidden === true},
              ${doorAccess.has(user.id)}, ${user.memberLevel}, ${user.phone},
              ${user.emergencyName}, ${user.emergencyPhone}, ${user.currentSkills},
              ${user.desiredSkills}, ${user.createdAt.slice(0, 10)}, ${user.id},
              ${user.createdAt})`
  }

  for (const cert of certifications) {
    await tx`
      insert into certifications (slug, name, description)
      values (${certSlug.get(cert.id) as string}, ${cert.name ?? cert.slug ?? 'unnamed'},
              ${cert.description})
      on conflict (slug) do nothing`
  }

  /**
   * Legacy cards.id is an EEPROM slot and cannot be regenerated. It is carried
   * into door_placements, not into credentials, so the first reconcile pass is
   * a no-op: the placements already describe what is on the device.
   *
   * One legacy card sits at slot 200, which the firmware writes and never
   * reads, so that member's card has silently never worked. It imports like any
   * other. The first pass refuses slot 200, says why, allocates a free slot
   * below the limit and writes the card properly.
   */
  for (const card of cards) {
    const token = cardId(card.cardNumber)
    const [credential] = await tx<Array<{ id: string }>>`
      insert into credentials (token, member_id, label, legacy_slot)
      values (${token}, ${memberId.get(card.userId as number) as string}, ${card.label}, ${card.id})
      returning id`

    await tx`
      insert into door_placements (controller_id, credential_id, placement)
      values (${controllerId}, ${credential?.id as string},
              ${tx.json(placementForLegacyCard(card.id, token, card.permissions ?? 1))})`
  }

  const granted = new Set<string>()
  for (const held of userCerts) {
    const member = held.userId === null ? undefined : memberId.get(held.userId)
    const slug = held.certificationId === null ? undefined : certSlug.get(held.certificationId)
    if (member === undefined || slug === undefined || granted.has(`${member}:${slug}`)) continue
    granted.add(`${member}:${slug}`)

    await tx`
      insert into member_certifications (member_id, cert_slug, granted_by, granted_at)
      values (${member}, ${slug},
              ${held.createdBy === null ? null : (memberId.get(held.createdBy) ?? null)},
              ${held.createdAt})`
  }

  for (const payment of payments) {
    const member = payment.userId === null ? undefined : memberId.get(payment.userId)
    if (member === undefined || payment.paidOn === null) continue
    await tx`
      insert into payments (member_id, amount, paid_on, recorded_by, legacy_id)
      values (${member}, ${payment.amount ?? '0'}, ${payment.paidOn},
              ${payment.createdBy === null ? null : (memberId.get(payment.createdBy) ?? null)},
              ${payment.id})`
  }

  for (const contract of contracts) {
    const member = contract.userId === null ? undefined : memberId.get(contract.userId)
    if (member === undefined) continue
    await tx`
      insert into waivers (member_id, signed_at, document, legacy_id)
      values (${member}, ${contract.signedAt ?? new Date().toISOString()},
              ${contract.documentFileName}, ${contract.id})`
  }
})

process.stdout.write('\nWritten. Now sign in on staging as three real migrated members from\n')
process.stdout.write('different eras of the space, using their known passwords, before anything\n')
process.stdout.write('touches production. Row counts are not verification.\n')

await Promise.all([legacy.end(), target.end()])
