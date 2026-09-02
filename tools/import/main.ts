import { readFileSync } from 'node:fs'

import { assertSnapshotComplete, beginReadOnly, countLegacy, readLegacy } from './legacy.ts'
import type { LegacyCounts, LegacySnapshot } from './legacy.ts'
import { load } from './load.ts'
import type { Client } from './pg.ts'
import { createClient } from './pg.ts'
import { formatFindings, preflight, refusals } from './preflight.ts'
import { formatReconciliation, reconcile } from './reconcile.ts'

/**
 * The one-time copy of the legacy Rails members database into this schema.
 * See docs/runbooks/import-the-members-database.md.
 *
 * It reads with LEGACY_DATABASE_URL over a read only connection and writes with
 * DATABASE_URL inside a single transaction. Any failure rolls the whole thing
 * back, because a half imported members database is worse than none.
 */

const APPLICATION_NAME = 'hsl-legacy-import'

export interface Options {
  dryRun: boolean
  acceptOrphans: boolean
}

const USAGE = `Usage: node --experimental-strip-types tools/import/main.ts [options]

  --dry-run          do everything, print the report, then roll back
  --accept-orphans   carry on past rows whose member no longer exists, skipping
                     them. Every one is listed first. Orphan cards are never
                     skipped.

  LEGACY_DATABASE_URL   the Rails database, opened read only
  DATABASE_URL          the members database this writes into`

/**
 * Compose mounts the database password as a file rather than putting it in the
 * environment, so a URL with no password picks it up from NAME_PASSWORD_FILE.
 * A password already in the URL wins, which is how this runs from a shell.
 */
function withMountedPassword(url: string, name: string): string {
  const path = process.env[`${name}_PASSWORD_FILE`]
  if (url === '' || path === undefined) return url

  const parsed = new URL(url)
  if (parsed.password !== '') return url

  parsed.password = readFileSync(path, 'utf8').trim()
  return parsed.toString()
}

export function parseArguments(argv: readonly string[]): Options | 'usage' {
  const options: Options = { dryRun: false, acceptOrphans: false }

  for (const argument of argv) {
    if (argument === '--dry-run') options.dryRun = true
    else if (argument === '--accept-orphans') options.acceptOrphans = true
    else if (argument === '--help' || argument === '-h') return 'usage'
    else throw new Error(`Unknown option ${argument}.\n\n${USAGE}`)
  }

  return options
}

/** Nothing is carried into a database that already holds members. */
const TARGET_TABLES = [
  'user', 'account', 'cards', 'certifications', 'user_certifications', 'payments', 'waivers',
]

async function assertTargetEmpty(target: Client): Promise<void> {
  for (const table of TARGET_TABLES) {
    const result = await target.query<{ n: string }>(`select count(*) as n from "${table}"`)
    const rows = Number(result.rows[0]?.n ?? 0)

    if (rows > 0) {
      throw new Error(
        `The target database already holds ${rows} rows in ${table}. The import runs once into ` +
          'an empty schema. Nothing was written. Rebuild the target from the migrations, or ' +
          'point DATABASE_URL at the database you meant.',
      )
    }
  }
}

async function readSource(legacy: Client): Promise<{
  snapshot: LegacySnapshot
  counts: LegacyCounts
}> {
  await beginReadOnly(legacy)
  const snapshot = await readLegacy(legacy)
  const counts = await countLegacy(legacy)
  assertSnapshotComplete(snapshot, counts)

  return { snapshot, counts }
}

export interface ImportResult {
  committed: boolean
  report: string
}

export async function runImport(
  legacy: Client,
  target: Client,
  options: Options,
): Promise<ImportResult> {
  const { snapshot, counts } = await readSource(legacy)
  const findings = preflight(snapshot)
  const preflightReport = formatFindings(findings, options.acceptOrphans)
  const stopping = refusals(findings, options.acceptOrphans)

  if (stopping.length > 0) {
    throw new Error(
      `${preflightReport}\n\nPreflight refused: ${stopping.length} checks failed. Nothing was ` +
        'written. Fix the rows above in the legacy database, or read the list and pass ' +
        '--accept-orphans if every remaining refusal is an orphan you are content to leave behind.',
    )
  }

  return writeTarget({ target, snapshot, counts, options }, preflightReport)
}

interface WriteInput {
  target: Client
  snapshot: LegacySnapshot
  counts: LegacyCounts
  options: Options
}

async function writeTarget(input: WriteInput, preflightReport: string): Promise<ImportResult> {
  const { target, snapshot, counts, options } = input
  await target.query('begin')

  try {
    await assertTargetEmpty(target)
    const loaded = await load(target, snapshot)
    const reconciliation = await reconcile(target, counts, loaded.skipped)
    const report = `${preflightReport}\n\n${formatReconciliation(reconciliation)}`

    if (!reconciliation.agrees) {
      await target.query('rollback')
      throw new Error(
        `${report}\n\nThe two databases disagree. Nothing was committed and the import did not ` +
          'succeed. The lines marked DISAGREES say which table to look at.',
      )
    }

    if (options.dryRun) {
      await target.query('rollback')
      return { committed: false, report: `${report}\n\nDry run. Everything was rolled back.` }
    }

    await target.query('commit')
    return { committed: true, report }
  } catch (error) {
    await target.query('rollback').catch(() => undefined)
    throw error
  }
}

/** Everything a bad invocation can hit, before either connection is opened. */
function readInvocation(): { options: Options; legacyUrl: string; targetUrl: string } | null {
  const options = parseArguments(process.argv.slice(2))

  if (options === 'usage') {
    console.log(USAGE)
    return null
  }

  const legacyUrl = withMountedPassword(process.env.LEGACY_DATABASE_URL ?? '', 'LEGACY_DATABASE')
  const targetUrl = withMountedPassword(process.env.DATABASE_URL ?? '', 'DATABASE')

  if (legacyUrl === '' || targetUrl === '') {
    throw new Error(`Set LEGACY_DATABASE_URL and DATABASE_URL.\n\n${USAGE}`)
  }

  return { options, legacyUrl, targetUrl }
}

async function main(): Promise<number> {
  let invocation
  try {
    invocation = readInvocation()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }

  if (invocation === null) return 0

  const { options, legacyUrl, targetUrl } = invocation
  const legacy = createClient(legacyUrl, APPLICATION_NAME)
  const target = createClient(targetUrl, APPLICATION_NAME)
  await legacy.connect()
  await target.connect()

  try {
    const result = await runImport(legacy, target, options)
    console.log(result.report)
    console.log(result.committed ? '\nImported and committed.' : '\nNothing was committed.')
    return 0
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  } finally {
    await legacy.query('rollback').catch(() => undefined)
    await legacy.end().catch(() => undefined)
    await target.end().catch(() => undefined)
  }
}

// Only when run directly, so the tests can import runImport and drive it themselves.
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main()
}
