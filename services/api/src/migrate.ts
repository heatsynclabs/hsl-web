import { migrate } from 'drizzle-orm/node-postgres/migrator'

import { loadConfig } from './config.ts'
import { createDatabase } from './db.ts'

/**
 * Applies the migrations in @hsl/schema and exits.
 *
 * This runs as its own one-shot container that the API waits on, rather than at
 * API boot, so two API containers can never race to migrate the same database
 * and a failed migration stops the deploy instead of leaving a service up
 * against a half migrated schema.
 *
 * The migrations directory is copied into the image beside dist. See the
 * Dockerfile.
 */

const MIGRATIONS_FOLDER = process.env.MIGRATIONS_FOLDER ?? '/app/migrations'

const config = loadConfig(process.env)
const { db, pool } = createDatabase(config)

try {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
  console.log('[migrate] schema is up to date')
} catch (error) {
  console.error(
    `[migrate] the migrations in ${MIGRATIONS_FOLDER} did not apply. The database was left as it ` +
      'was and nothing else was started.',
  )
  console.error(error)
  process.exitCode = 1
} finally {
  await pool.end()
}
