import { fileURLToPath } from 'node:url'

import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { sql } from 'drizzle-orm'
import { Pool } from 'pg'

/**
 * Rebuilds the schema from nothing before the suite runs, so a migration that
 * only works against an already migrated database fails here rather than in
 * production. Without DATABASE_URL the database suites skip themselves.
 *
 * The migrations are @hsl/schema's. This service owns no DDL.
 */
const MIGRATIONS_FOLDER = fileURLToPath(
  new URL('../../../../packages/schema/migrations', import.meta.url),
)

export default async function setup(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL
  if (databaseUrl === undefined || databaseUrl === '') return

  const pool = new Pool({ connectionString: databaseUrl })
  const db = drizzle(pool)

  try {
    // drizzle records applied migrations in its own schema, so both go.
    await db.execute(sql`drop schema if exists drizzle cascade`)
    await db.execute(sql`drop schema if exists public cascade`)
    await db.execute(sql`create schema public`)
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
  } finally {
    await pool.end()
  }
}
