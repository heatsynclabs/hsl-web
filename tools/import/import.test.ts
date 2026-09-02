import { createRequire } from 'node:module'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { ImportResult, Options } from './main.ts'
import { runImport } from './main.ts'
import { createClient } from './pg.ts'
import type { Client } from './pg.ts'
import {
  FIXTURE_HASHES,
  FIXTURE_PASSWORDS,
  FIXTURE_SLOTS,
  MEMBER_HOLDING_THE_UNUSUAL_MASK,
  MEMBER_WITHOUT_A_PASSWORD,
  SHORT_CARD_NUMBER_PADDED,
  addOrphanContract,
  seedFixture,
} from './test-support/fixtures.ts'

/**
 * The import against two real Postgres databases. Nothing here is mocked: a
 * stubbed query builder would not have caught a single defect this script is
 * written to avoid.
 */

const targetUrl = process.env.DATABASE_URL ?? null
const legacyUrl = process.env.LEGACY_DATABASE_URL ?? null

const bcrypt = createRequire(new URL('../../services/api/package.json', import.meta.url))(
  'bcryptjs',
) as { compareSync: (password: string, hash: string) => boolean }

/**
 * Cleared with DELETE in dependency order rather than TRUNCATE CASCADE, because
 * migration 0002 refuses to truncate audit_log and door_events and CASCADE
 * would drag both in. The import writes to neither, so both stay empty.
 */
const TARGET_TABLES = [
  'session', 'account', 'cards', 'user_certifications', 'payments', 'waivers',
  'certifications', 'user',
]

function describeDatabases(name: string, define: () => void): void {
  if (targetUrl === null || legacyUrl === null) {
    const why =
      'skipped: set DATABASE_URL and LEGACY_DATABASE_URL to two Postgres databases this suite may rebuild'
    describe.skip(`${name} [${why}]`, define)
    return
  }

  describe(name, define)
}

describeDatabases('the legacy import', () => {
  let inspect: Client
  let seeder: Client

  beforeAll(async () => {
    inspect = createClient(targetUrl as string, 'hsl-import-tests')
    seeder = createClient(legacyUrl as string, 'hsl-import-tests')
    await inspect.connect()
    await seeder.connect()
  })

  afterAll(async () => {
    await inspect.end()
    await seeder.end()
  })

  beforeEach(async () => {
    for (const table of TARGET_TABLES) {
      await inspect.query(`delete from "${table}"`)
    }
    await seedFixture(seeder)
  })

  async function importFixture(options: Partial<Options> = {}): Promise<ImportResult> {
    const legacy = createClient(legacyUrl as string, 'hsl-import-tests')
    const target = createClient(targetUrl as string, 'hsl-import-tests')
    await legacy.connect()
    await target.connect()

    try {
      return await runImport(legacy, target, {
        dryRun: false,
        acceptOrphans: false,
        ...options,
      })
    } finally {
      await legacy.query('rollback').catch(() => undefined)
      await legacy.end()
      await target.end()
    }
  }

  async function column<Value>(sql: string, values: unknown[] = []): Promise<Value[]> {
    const result = await inspect.query<Record<string, Value>>(sql, values)
    return result.rows.map((row) => Object.values(row)[0] as Value)
  }

  it('keeps every card slot exactly as it was', async () => {
    await importFixture()

    expect(await column<number>('select id from cards order by id')).toEqual(FIXTURE_SLOTS)
  })

  it('reports the card the reader cannot see and imports anyway', async () => {
    const result = await importFixture()

    expect(result.committed).toBe(true)
    expect(result.report).toContain('card slot the reader cannot see')
    expect(result.report).toContain('NOTICE')
    expect(await column<number>('select id from cards where id = 200')).toEqual([200])
  })

  it('copies the bcrypt hash into the account row byte for byte', async () => {
    await importFixture()

    const [account] = (
      await inspect.query<{ password: string; providerId: string; issuer: string; same: boolean }>(
        `select a.password, a.provider_id as "providerId", a.issuer,
                a.account_id = u.id as "same"
         from account a join "user" u on u.id = a.user_id
         where u.legacy_id = 1`,
      )
    ).rows

    expect(account?.password).toBe(FIXTURE_HASHES[1])
    expect(account?.providerId).toBe('credential')
    expect(account?.issuer).toBe('local:credential')
    expect(account?.same).toBe(true)
    expect(bcrypt.compareSync(FIXTURE_PASSWORDS[1] as string, account?.password as string)).toBe(true)
  })

  it('gives a member with no password a member row and no credential', async () => {
    await importFixture()

    const rows = await column<string>(
      'select a.id from account a join "user" u on u.id = a.user_id where u.legacy_id = $1',
      [MEMBER_WITHOUT_A_PASSWORD],
    )

    expect(rows).toEqual([])
    expect(
      await column<number>('select legacy_id from "user" where legacy_id = $1', [
        MEMBER_WITHOUT_A_PASSWORD,
      ]),
    ).toEqual([MEMBER_WITHOUT_A_PASSWORD])
  })

  it('derives card access from a permission of exactly 1', async () => {
    await importFixture()

    const access = await inspect.query<{ legacyId: number; cardAccess: boolean }>(
      'select legacy_id as "legacyId", card_access as "cardAccess" from "user" order by legacy_id',
    )

    expect(access.rows).toEqual([
      { legacyId: 1, cardAccess: true },
      // Holds only the mask 255 card, which User#card_access_enabled never counted.
      { legacyId: MEMBER_HOLDING_THE_UNUSUAL_MASK, cardAccess: false },
      { legacyId: 3, cardAccess: true },
      // Holds the slot 200 card. The members database said yes and the reader
      // never agreed. The import carries the record as it stands and the
      // preflight is what tells the operator about it.
      { legacyId: 4, cardAccess: true },
      { legacyId: 5, cardAccess: false },
    ])
  })

  it('pads a five character card number to eight uppercase hex characters', async () => {
    await importFixture()

    expect(await column<string>('select card_number from cards where id = 199')).toEqual([
      SHORT_CARD_NUMBER_PADDED,
    ])
  })

  it('turns a decimal amount into whole cents and keeps a missing one visible', async () => {
    await importFixture()

    const rows = await inspect.query<{ cents: number; note: string | null }>(
      'select amount_cents as cents, note from payments order by paid_on',
    )

    expect(rows.rows.map((row) => row.cents)).toEqual([5000, 0, 2500])
    expect(rows.rows[1]?.note).toContain('no amount')
  })

  it('rolls everything back when one row fails', async () => {
    await inspect.query('alter table payments add constraint dues_ceiling check (amount_cents < 100)')

    try {
      await expect(importFixture()).rejects.toThrow()
    } finally {
      await inspect.query('alter table payments drop constraint dues_ceiling')
    }

    expect(await column<string>('select count(*) from "user"')).toEqual(['0'])
    expect(await column<string>('select count(*) from cards')).toEqual(['0'])
    expect(await column<string>('select count(*) from account')).toEqual(['0'])
  })

  it('refuses an orphan release until the operator accepts it', async () => {
    await addOrphanContract(seeder)

    await expect(importFixture()).rejects.toThrow(/orphan signed release/)
    expect(await column<string>('select count(*) from "user"')).toEqual(['0'])

    const result = await importFixture({ acceptOrphans: true })

    expect(result.committed).toBe(true)
    expect(await column<string>('select count(*) from waivers')).toEqual(['2'])
    expect(result.report).toContain('signed releases')
  })

  it('reconciles both sides and says so', async () => {
    const result = await importFixture()

    expect(result.report).toContain('Reconciliation:')
    expect(result.report).not.toContain('DISAGREES')
    expect(await column<string>('select count(*) from "user"')).toEqual(['5'])
    expect(await column<string>('select count(*) from user_certifications')).toEqual(['2'])
    expect(await column<string>('select count(*) from certifications')).toEqual(['2'])
  })

  it('writes nothing on a dry run', async () => {
    const result = await importFixture({ dryRun: true })

    expect(result.committed).toBe(false)
    expect(result.report).toContain('rolled back')
    expect(await column<string>('select count(*) from "user"')).toEqual(['0'])
  })

  it('refuses to run twice into the same database', async () => {
    await importFixture()

    await expect(importFixture()).rejects.toThrow(/already holds/)
    expect(await column<string>('select count(*) from "user"')).toEqual(['5'])
  })
})
