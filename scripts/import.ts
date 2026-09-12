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
  postalCode: string | null
  emergencyName: string | null
  emergencyPhone: string | null
  emergencyEmail: string | null
  currentSkills: string | null
  desiredSkills: string | null
  memberLevel: number | null
  orientation: string | null
  waiver: string | null
  hidden: boolean | null
  emailVisible: boolean | null
  phoneVisible: boolean | null
  admin: boolean | null
  instructor: boolean | null
  accountant: boolean | null
  createdAt: string
  updatedAt: string
}

interface LegacyCard {
  id: number
  cardNumber: string | null
  permissions: number | null
  userId: number | null
  label: string | null
  createdAt: string | null
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
  cosigner: string | null
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

/**
 * Every read in one snapshot.
 *
 * Without the transaction each query sees the database as it is at that moment,
 * so a member edited between the users read and the cards read produces a copy
 * that never existed. The runbook says to point this at a restored copy nobody
 * is writing to, and this is what makes that a belt rather than a hope.
 */
const snapshot = await legacy.begin(async (tx) => {
  await tx.unsafe('set transaction isolation level repeatable read')

  return {
    users: await tx<LegacyUser[]>`
      select id, name, email, encrypted_password as "encryptedPassword", phone,
             postal_code as "postalCode",
             emergency_name as "emergencyName", emergency_phone as "emergencyPhone",
             emergency_email as "emergencyEmail",
             current_skills as "currentSkills", desired_skills as "desiredSkills",
             member_level as "memberLevel", hidden,
             email_visible as "emailVisible", phone_visible as "phoneVisible",
             admin, instructor, accountant,
             to_char(orientation, ${tx.unsafe(UTC)}) as "orientation",
             to_char(waiver, ${tx.unsafe(UTC)}) as "waiver",
             to_char(created_at, ${tx.unsafe(UTC)}) as "createdAt",
             to_char(updated_at, ${tx.unsafe(UTC)}) as "updatedAt"
      from users order by id`,

    cards: await tx<LegacyCard[]>`
      select id, card_number as "cardNumber", card_permissions as "permissions",
             user_id as "userId", name as "label",
             to_char(created_at, ${tx.unsafe(UTC)}) as "createdAt"
      from cards order by id`,

    certifications: await tx<LegacyCert[]>`
      select id, slug, name, description from certifications order by id`,

    userCerts: await tx<LegacyUserCert[]>`
      select id, user_id as "userId", certification_id as "certificationId",
             created_by as "createdBy",
             to_char(created_at, ${tx.unsafe(UTC)}) as "createdAt"
      from user_certifications order by id`,

    payments: await tx<LegacyPayment[]>`
      select id, user_id as "userId", amount::text as amount,
             to_char("date", 'YYYY-MM-DD') as "paidOn", created_by as "createdBy"
      from payments order by id`,

    contracts: await tx<LegacyContract[]>`
      select id, user_id as "userId", document_file_name as "documentFileName", cosigner,
             to_char(signed_at, ${tx.unsafe(UTC)}) as "signedAt"
      from contracts order by id`,
  }
})

const { users, cards, certifications, userCerts, payments, contracts } = snapshot

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

/**
 * Two certifications that normalise to one slug would merge into one row, and
 * every grant of the second would land on the first. Certifications are what
 * the interlocks ask about, so this is a refusal rather than a warning.
 */
const seenSlug = new Map<string, number>()
for (const cert of certifications) {
  const slug = certSlug.get(cert.id) as string
  const first = seenSlug.get(slug)
  if (first !== undefined) {
    failures.push(
      `certifications ${first} and ${cert.id} both normalise to the slug ${slug}, which would ` +
        'merge two tool certifications into one',
    )
  }
  seenSlug.set(slug, cert.id)
}

/**
 * What the write below will actually insert, decided here so the report counts
 * rows rather than intentions.
 *
 * The write has always skipped a row it could not place. The report counted the
 * legacy table, so anybody comparing row counts afterwards found fewer and no
 * reason why, and a payment with no date went out without a word.
 */
const grants = new Set<string>()
for (const held of userCerts) {
  if (held.userId === null || !memberId.has(held.userId)) {
    warnings.push(`user_certifications ${held.id} belongs to no user that exists, and is left behind`)
    continue
  }
  if (held.certificationId === null || !certSlug.has(held.certificationId)) {
    warnings.push(
      `user_certifications ${held.id} names certification ${held.certificationId}, which is not ` +
        'in certifications, and is left behind',
    )
    continue
  }
  const pair = `${memberId.get(held.userId) as string}:${certSlug.get(held.certificationId) as string}`
  if (grants.has(pair)) warnings.push(`user_certifications ${held.id} repeats a pair already granted`)
  grants.add(pair)
}

const payable: LegacyPayment[] = []
for (const payment of payments) {
  if (payment.userId === null || !memberId.has(payment.userId)) {
    warnings.push(`payment ${payment.id} belongs to no user that exists, and is left behind`)
    continue
  }
  if (payment.paidOn === null) {
    warnings.push(`payment ${payment.id} has no date, and is left behind`)
    continue
  }
  // legacy payments.amount has no not-null constraint. It lands as 0.00, which
  // is a number nobody entered, so it is said out loud rather than assumed.
  if (payment.amount === null) {
    warnings.push(`payment ${payment.id} has no amount, and imports as 0.00`)
  }
  payable.push(payment)
}

const signed: LegacyContract[] = []
for (const contract of contracts) {
  if (contract.userId === null || !memberId.has(contract.userId)) {
    warnings.push(`contract ${contract.id} belongs to no user that exists, and is left behind`)
    continue
  }
  signed.push(contract)
}

/** A member with a waiver date and no contract row gets a waiver from the date. */
const contractHolders = new Set(signed.map((contract) => memberId.get(contract.userId as number) as string))
const waiverDates = users.filter(
  (user) => user.waiver !== null && !contractHolders.has(memberId.get(user.id) as string),
).length

// The report ----------------------------------------------------------------------

/** Rows this will write, not rows the legacy database holds. */
const counted = {
  members: users.length,
  credentials: cards.length,
  certifications: certifications.length,
  memberCertifications: grants.size,
  payments: payable.length,
  waivers: signed.length + waiverDates,
  withDoorAccess: doorAccess.size,
  withoutPassword: users.filter((user) => (user.encryptedPassword ?? '').trim() === '').length,
  leftBehind: {
    memberCertifications: userCerts.length - grants.size,
    payments: payments.length - payable.length,
    waivers: contracts.length - signed.length,
  },
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
      insert into members (id, email, name, password, roles, oriented_on, hidden, door_access,
                           member_level, phone, postal_code, emergency_name, emergency_phone,
                           emergency_email, current_skills, desired_skills,
                           email_visible, phone_visible,
                           joined_on, legacy_id, created_at, updated_at)
      values (${memberId.get(user.id) as string}, ${user.email.trim().toLowerCase()},
              ${(user.name ?? user.email).trim()}, ${password === '' ? null : password},
              ${rolesOf(user)}, ${user.orientation?.slice(0, 10) ?? null}, ${user.hidden === true},
              ${doorAccess.has(user.id)}, ${user.memberLevel}, ${user.phone}, ${user.postalCode},
              ${user.emergencyName}, ${user.emergencyPhone}, ${user.emergencyEmail},
              ${user.currentSkills}, ${user.desiredSkills},
              ${user.emailVisible === true}, ${user.phoneVisible === true},
              ${user.createdAt.slice(0, 10)}, ${user.id},
              ${user.createdAt}, ${user.updatedAt})`
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
      insert into credentials (token, member_id, label, issued_on, legacy_slot)
      values (${token}, ${memberId.get(card.userId as number) as string}, ${card.label},
              ${card.createdAt?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)}, ${card.id})
      returning id`

    await tx`
      insert into door_placements (controller_id, credential_id, placement)
      values (${controllerId}, ${credential?.id as string},
              ${tx.json(placementForLegacyCard(card.id, token, card.permissions ?? 1))})`
  }

  // The preflight decided which of these land and counted them. Walking the
  // same rows against the same set is what keeps the report honest.
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

  for (const payment of payable) {
    const member = memberId.get(payment.userId as number) as string
    await tx`
      insert into payments (member_id, amount, paid_on, recorded_by, legacy_id)
      values (${member}, ${payment.amount ?? '0'}, ${payment.paidOn},
              ${payment.createdBy === null ? null : (memberId.get(payment.createdBy) ?? null)},
              ${payment.id})`
  }

  const hasWaiver = new Set<string>()
  for (const contract of signed) {
    const member = memberId.get(contract.userId as number) as string
    hasWaiver.add(member)
    await tx`
      insert into waivers (member_id, signed_at, document, cosigner, legacy_id)
      values (${member}, ${contract.signedAt ?? new Date().toISOString()},
              ${contract.documentFileName}, ${contract.cosigner}, ${contract.id})`
  }

  /**
   * `users.waiver` is a second place the legacy system recorded that somebody
   * signed. There are 318 contracts and 1,061 users, so most members who signed
   * have a date here and no document row, and carrying only the contracts would
   * leave them looking as though they had never signed anything.
   */
  for (const user of users) {
    const member = memberId.get(user.id) as string
    if (user.waiver === null || hasWaiver.has(member)) continue
    await tx`
      insert into waivers (member_id, signed_at, document)
      values (${member}, ${user.waiver}, null)`
  }
})

process.stdout.write('\nWritten. Now sign in on staging as three real migrated members from\n')
process.stdout.write('different eras of the space, using their known passwords, before anything\n')
process.stdout.write('touches production. Row counts are not verification.\n')

await Promise.all([legacy.end(), target.end()])
