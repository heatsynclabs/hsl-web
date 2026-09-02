import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { createClient } from '../pg.ts'
import type { Client } from '../pg.ts'
import { rebuildLegacySchema } from './legacy-schema.ts'

/**
 * Two real Postgres databases, both rebuilt from nothing before the suite runs.
 * The target is replayed from packages/schema/migrations, so a migration that
 * only works against an already migrated database fails here. The source gets
 * the legacy DDL.
 *
 * Without both URLs the database suites skip themselves rather than failing.
 * Per decisions/0007-postgres-for-tests-comes-from-compose.md, both point at
 * databases on the Compose db service.
 */

const MIGRATIONS = fileURLToPath(new URL('../../../packages/schema/migrations', import.meta.url))

// drizzle-kit writes this between statements in the files it generates.
const STATEMENT_BREAKPOINT = '--> statement-breakpoint'

async function replayMigrations(target: Client): Promise<void> {
  await target.query('drop schema if exists public cascade')
  await target.query('create schema public')

  const files = (await readdir(MIGRATIONS)).filter((name) => name.endsWith('.sql')).sort()

  for (const file of files) {
    const sql = await readFile(`${MIGRATIONS}/${file}`, 'utf8')

    for (const statement of sql.split(STATEMENT_BREAKPOINT)) {
      if (statement.trim() === '') continue
      await target.query(statement)
    }
  }
}

export default async function setup(): Promise<void> {
  const targetUrl = process.env.DATABASE_URL ?? ''
  const legacyUrl = process.env.LEGACY_DATABASE_URL ?? ''
  if (targetUrl === '' || legacyUrl === '') return

  const target = createClient(targetUrl, 'hsl-import-tests')
  const legacy = createClient(legacyUrl, 'hsl-import-tests')
  await target.connect()
  await legacy.connect()

  try {
    await replayMigrations(target)
    await rebuildLegacySchema(legacy)
  } finally {
    await target.end()
    await legacy.end()
  }
}
