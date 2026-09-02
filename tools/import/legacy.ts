import type { Client } from './pg.ts'

/**
 * Reading the legacy Rails database. Column names come from db/schema.rb in
 * heatsynclabs/Open-Source-Access-Control-Web-Interface at version
 * 20141120200638, read on 2026-09-01, and the query shape follows
 * seedfromold.js in temporary-hsl-infra. See ATTRIBUTIONS.md.
 *
 * The connection is opened read only and every read happens inside one
 * snapshot, so a member who edits their profile while this runs cannot produce
 * a half consistent copy. Postgres 8.4 has no jsonb, no LATERAL and no ordered
 * set aggregates, so all of this is plain SQL.
 *
 * ASSUMPTION: the legacy timestamps are stored in UTC.
 * CONFIRM BY: config/application.rb sets config.time_zone to America/Phoenix
 *   and never sets config.active_record.default_timezone, whose Rails 3.2
 *   default is :utc. Confirm against the Rails 3.2.8 gem rather than the
 *   application before cutover.
 * BLAST RADIUS: every waiver, orientation and payment date lands seven hours
 *   away from where it belongs.
 */

// to_char rather than a timestamp parse, because node-postgres reads a
// `timestamp without time zone` into whatever timezone the importing machine
// happens to be in.
const AS_UTC_TEXT = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`

function utc(column: string, alias: string): string {
  // The stored value is already UTC wall time in a naive column, so it is
  // rendered verbatim and labelled. Converting it here would shift it twice.
  return `to_char(${column}, ${AS_UTC_TEXT}) as "${alias}"`
}

export interface LegacyUser {
  id: number
  name: string | null
  email: string
  encryptedPassword: string | null
  phone: string | null
  postalCode: string | null
  emergencyName: string | null
  emergencyPhone: string | null
  emergencyEmail: string | null
  memberLevel: number | null
  waiver: string | null
  orientation: string | null
  orientedById: number | null
  hidden: boolean | null
  emailVisible: boolean | null
  phoneVisible: boolean | null
  currentSkills: string | null
  desiredSkills: string | null
  paymentMethod: string | null
  payee: string | null
  admin: boolean | null
  instructor: boolean | null
  accountant: boolean | null
  createdAt: string
  updatedAt: string
}

export interface LegacyCard {
  id: number
  cardNumber: string | null
  permissions: number | null
  userId: number | null
  label: string | null
}

export interface LegacyCertification {
  id: number
  slug: string | null
  name: string | null
  description: string | null
}

export interface LegacyUserCertification {
  id: number
  userId: number | null
  certificationId: number | null
  createdBy: number | null
  createdAt: string
}

export interface LegacyPayment {
  id: number
  userId: number | null
  amount: string | null
  paidOn: string | null
  createdBy: number | null
  createdAt: string
}

export interface LegacyContract {
  id: number
  userId: number | null
  signedAt: string | null
  documentFileName: string | null
  cosigner: string | null
  createdById: number | null
  createdAt: string
}

export interface LegacySnapshot {
  users: LegacyUser[]
  cards: LegacyCard[]
  certifications: LegacyCertification[]
  userCertifications: LegacyUserCertification[]
  payments: LegacyPayment[]
  contracts: LegacyContract[]
}

const USERS_SQL = `
  select id, name, email, encrypted_password as "encryptedPassword", phone,
         postal_code as "postalCode", emergency_name as "emergencyName",
         emergency_phone as "emergencyPhone", emergency_email as "emergencyEmail",
         member_level as "memberLevel", oriented_by_id as "orientedById",
         hidden, email_visible as "emailVisible", phone_visible as "phoneVisible",
         current_skills as "currentSkills", desired_skills as "desiredSkills",
         payment_method as "paymentMethod", payee, admin, instructor, accountant,
         ${utc('waiver', 'waiver')},
         ${utc('orientation', 'orientation')},
         ${utc('created_at', 'createdAt')},
         ${utc('updated_at', 'updatedAt')}
  from users
  order by id
`

const CARDS_SQL = `
  select id, card_number as "cardNumber", card_permissions as "permissions",
         user_id as "userId", name as "label"
  from cards
  order by id
`

const CERTIFICATIONS_SQL = `
  select id, slug, name, description from certifications order by id
`

const USER_CERTIFICATIONS_SQL = `
  select id, user_id as "userId", certification_id as "certificationId",
         created_by as "createdBy",
         ${utc('created_at', 'createdAt')}
  from user_certifications
  order by id
`

const PAYMENTS_SQL = `
  select id, user_id as "userId", amount,
         to_char("date", 'YYYY-MM-DD') as "paidOn",
         created_by as "createdBy",
         ${utc('created_at', 'createdAt')}
  from payments
  order by id
`

const CONTRACTS_SQL = `
  select id, user_id as "userId",
         document_file_name as "documentFileName", cosigner,
         created_by_id as "createdById",
         ${utc('signed_at', 'signedAt')},
         ${utc('created_at', 'createdAt')}
  from contracts
  order by id
`

/** Refuses every write for the life of the connection, before any read runs. */
export async function beginReadOnly(legacy: Client): Promise<void> {
  await legacy.query('set session characteristics as transaction read only')
  await legacy.query('begin transaction isolation level repeatable read read only')
}

export async function readLegacy(legacy: Client): Promise<LegacySnapshot> {
  return {
    users: (await legacy.query<LegacyUser>(USERS_SQL)).rows,
    cards: (await legacy.query<LegacyCard>(CARDS_SQL)).rows,
    certifications: (await legacy.query<LegacyCertification>(CERTIFICATIONS_SQL)).rows,
    userCertifications: (await legacy.query<LegacyUserCertification>(USER_CERTIFICATIONS_SQL)).rows,
    payments: (await legacy.query<LegacyPayment>(PAYMENTS_SQL)).rows,
    contracts: (await legacy.query<LegacyContract>(CONTRACTS_SQL)).rows,
  }
}

export interface LegacyCounts {
  users: number
  credentials: number
  cards: number
  cardAccessMembers: number
  certifications: number
  userCertifications: number
  payments: number
  contracts: number
}

/**
 * Counted by the legacy database itself, inside the same snapshot the rows were
 * read in. The import compares these against what it actually read, so a query
 * that silently returned short is caught before anything is committed.
 */
const COUNTS_SQL = `
  select
    (select count(*) from users) as "users",
    (select count(*) from users where coalesce(btrim(encrypted_password), '') <> '') as "credentials",
    (select count(*) from cards) as "cards",
    (select count(distinct user_id) from cards where card_permissions = 1) as "cardAccessMembers",
    (select count(*) from certifications) as "certifications",
    (select count(*) from user_certifications) as "userCertifications",
    (select count(*) from payments) as "payments",
    (select count(*) from contracts) as "contracts"
`

export async function countLegacy(legacy: Client): Promise<LegacyCounts> {
  const result = await legacy.query<Record<keyof LegacyCounts, string>>(COUNTS_SQL)
  const row = result.rows[0]

  if (row === undefined) throw new Error('the legacy database returned no counts')

  return {
    users: Number(row.users),
    credentials: Number(row.credentials),
    cards: Number(row.cards),
    cardAccessMembers: Number(row.cardAccessMembers),
    certifications: Number(row.certifications),
    userCertifications: Number(row.userCertifications),
    payments: Number(row.payments),
    contracts: Number(row.contracts),
  }
}

/** The read is only trustworthy if it brought back as many rows as the source holds. */
export function assertSnapshotComplete(snapshot: LegacySnapshot, counts: LegacyCounts): void {
  const read: Array<[string, number, number]> = [
    ['users', snapshot.users.length, counts.users],
    ['cards', snapshot.cards.length, counts.cards],
    ['certifications', snapshot.certifications.length, counts.certifications],
    ['user_certifications', snapshot.userCertifications.length, counts.userCertifications],
    ['payments', snapshot.payments.length, counts.payments],
    ['contracts', snapshot.contracts.length, counts.contracts],
  ]

  for (const [table, got, expected] of read) {
    if (got !== expected) {
      throw new Error(
        `Read ${got} rows from legacy ${table} but the table holds ${expected}. ` +
          'Nothing was written. Run it again; if it repeats, the legacy database is changing ' +
          'under the read and the Rails application needs stopping first.',
      )
    }
  }
}
