import { readdir, readFile } from 'node:fs/promises'

import postgres from 'postgres'

/**
 * Apply the migrations that have not run yet, oldest first, each in its own
 * transaction.
 *
 * Forward only. There is no down migration, because the way back from a bad
 * release is the previous image, and that only works if each migration leaves
 * the previous version of the code running: add a column one release before
 * anything uses it, drop it one release after.
 */

const url = process.env.DATABASE_URL
if (url === undefined || url === '') {
  process.stdout.write('DATABASE_URL is not set, so nothing ran. .env.example has it.\n')
  process.exit(1)
}

const directory = new URL('../migrations/', import.meta.url)
const sql = postgres(url)

await sql`
  create table if not exists schema_migrations (
    name text primary key,
    at   timestamptz not null default now()
  )`

const applied = new Set((await sql<Array<{ name: string }>>`select name from schema_migrations`).map((row) => row.name))
const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()

for (const file of files) {
  if (applied.has(file)) continue

  const body = await readFile(new URL(file, directory), 'utf8')
  await sql.begin(async (tx) => {
    // Simple protocol, because a migration is many statements in one file.
    await tx.unsafe(body).simple()
    await tx`insert into schema_migrations (name) values (${file})`
  })
  process.stdout.write(`applied ${file}\n`)
}

process.stdout.write(`${files.length - applied.size} applied, ${applied.size} already there\n`)
await sql.end()
