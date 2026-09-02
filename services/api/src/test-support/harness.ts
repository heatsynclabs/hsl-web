import type { Card, Certification, DoorStatus, Member, NewMember } from '@hsl/schema'
import { cards, certifications, doorEvents, user } from '@hsl/schema'
import { eq, sql } from 'drizzle-orm'
import { describe } from 'vitest'

import { createApp } from '../app.ts'
import type { Auth } from '../auth.ts'
import { createAuth } from '../auth.ts'
import type { Config } from '../config.ts'
import { loadConfig } from '../config.ts'
import type { Database } from '../db.ts'
import { createDatabase } from '../db.ts'

/**
 * One app, one real Postgres, no port. Tests drive the app in process through
 * hono/testing, and members are created through better-auth so the sign-in path
 * under test is the one production uses.
 */

const databaseUrl = process.env.DATABASE_URL ?? null

const TEST_PASSWORD = 'a wrench and a soldering iron'

/**
 * The tables a test changes while the members stay as they were. Creating a
 * member costs a bcrypt hash, so suites make them once and clear this much
 * between tests.
 */
const ACTIVITY_TABLES = [
  'cards',
  'user_certifications',
  'certifications',
  'payments',
  'waivers',
  'audit_log',
  'door_events',
]

const TABLES = [
  'session',
  'account',
  'verification',
  'cards',
  'user_certifications',
  'certifications',
  'payments',
  'waivers',
  'audit_log',
  'door_events',
  'user',
]

let emailCounter = 0

export interface Harness {
  db: Database
  auth: Auth
  config: Config
  app: ReturnType<typeof createApp>
  reset: () => Promise<void>
  clearActivity: () => Promise<void>
  close: () => Promise<void>
}

export interface SignedInMember {
  member: Member
  headers: { cookie: string }
}

/**
 * A suite that needs Postgres. Without DATABASE_URL it is skipped rather than
 * failed, and the name says what to set.
 */
export function describeDatabase(name: string, define: () => void): void {
  if (databaseUrl === null) {
    const why = 'skipped: set DATABASE_URL to a Postgres this suite may rebuild'
    describe.skip(`${name} [${why}]`, define)
    return
  }

  describe(name, define)
}

export function testConfig(): Config {
  return loadConfig({
    DATABASE_URL: databaseUrl ?? 'postgres://unused',
    PUBLIC_ORIGIN: 'http://localhost:3000',
    AUTH_SECRET: 'a test secret that is long enough',
    DOOR_TOKEN: 'a test door token that is long enough',
    DOOR_STATUS_STALE_SECONDS: '120',
  })
}

export function createHarness(): Harness {
  const config = testConfig()
  const { db, pool } = createDatabase(config)
  const auth = createAuth(db, config)

  return {
    db,
    auth,
    config,
    app: createApp({ db, auth, config }),
    reset: () => truncate(db, TABLES),
    clearActivity: () => truncate(db, ACTIVITY_TABLES),
    close: () => pool.end(),
  }
}

/**
 * audit_log and door_events refuse UPDATE, DELETE and TRUNCATE in the database,
 * because they are the record of who opened a building and who changed who could.
 * See migrations 0001 and 0002.
 *
 * Tests need a clean table between cases, so this suspends that refusal for the
 * length of one statement and turns it straight back on. session_replication_role
 * is per session and this pool is the test's own, so nothing outside sees it.
 * Never do this anywhere but here.
 */
async function truncate(db: Database, tables: string[]): Promise<void> {
  const names = tables.map((table) => `"${table}"`).join(', ')
  await db.execute(sql.raw(`set session_replication_role = replica`))
  try {
    await db.execute(sql.raw(`truncate table ${names} restart identity cascade`))
  } finally {
    await db.execute(sql.raw(`set session_replication_role = default`))
  }
}

/** Creates a member with the given fields and returns the cookie that signs them in. */
export async function addMember(
  harness: Harness,
  overrides: Partial<NewMember> = {},
): Promise<SignedInMember> {
  emailCounter += 1
  const email = overrides.email ?? `member${emailCounter}@example.test`
  const name = overrides.name ?? `Test Member ${emailCounter}`

  const created = await harness.auth.api.signUpEmail({
    body: { name, email, password: TEST_PASSWORD },
    returnHeaders: true,
  })

  const updated = await harness.db
    .update(user)
    .set({ ...overrides, email, name, updatedAt: new Date() })
    .where(eq(user.id, created.response.user.id))
    .returning()

  const member = updated[0]
  if (member === undefined) throw new Error('The member row was not written.')

  return { member, headers: { cookie: cookieHeader(created.headers) } }
}

function cookieHeader(headers: Headers): string {
  return headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .filter((pair): pair is string => pair !== undefined)
    .join('; ')
}

/** The credential the door service presents, as a header. */
export function doorHeaders(harness: Harness): { authorization: string } {
  return { authorization: `Bearer ${harness.config.doorToken}` }
}

/**
 * Puts a status snapshot in door_events the way a door service report would, so
 * a test can decide whether the last report is fresh or stale.
 */
export async function reportDoorStatus(
  harness: Harness,
  status: Partial<DoorStatus> = {},
  at: Date = new Date(),
): Promise<void> {
  const locked: DoorStatus = {
    frontLocked: true,
    rearLocked: true,
    armed: 255,
    activated: 255,
    alarm2: 1,
    alarm3: 1,
    ...status,
  }

  await harness.db.insert(doorEvents).values({ kind: 'status', at, detail: locked })
}

/** One row of the tool list. The ten real slugs are seeded by the import, not here. */
export async function addCertification(
  harness: Harness,
  slug = 'laser',
  name = 'Laser Cutter',
): Promise<Certification> {
  const rows = await harness.db.insert(certifications).values({ slug, name }).returning()
  const row = rows[0]
  if (row === undefined) throw new Error('The certification row was not written.')
  return row
}

/** A card already in a slot, for the tests that are not about assigning one. */
export async function addCard(
  harness: Harness,
  userId: string,
  slot: number,
  cardNumber = String(slot).padStart(8, '0'),
): Promise<Card> {
  const rows = await harness.db.insert(cards).values({ id: slot, cardNumber, userId }).returning()
  const row = rows[0]
  if (row === undefined) throw new Error('The card row was not written.')
  return row
}

/**
 * The body of a response that was supposed to succeed. Every route can also
 * answer with an error shape, so a test that reads a field has to say which it
 * expected, and a refusal fails the test where it happened rather than three
 * lines later.
 */
export function ok<T extends object>(body: T): Exclude<T, { error: string }> {
  if ('error' in body) {
    throw new Error(`The route refused the request: ${String(body.error)}`)
  }

  return body as Exclude<T, { error: string }>
}
