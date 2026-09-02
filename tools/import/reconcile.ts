import type { LegacyCounts } from './legacy.ts'
import type { Client } from './pg.ts'
import { CARD_ACCESS_PERMISSION } from './transform.ts'

/**
 * Row counts from both databases side by side, read after the writes and before
 * the commit. The right hand column comes from the target database and the left
 * from the legacy one. Neither comes from what the loader believes it wrote,
 * because the loader believing something is not evidence.
 */

export interface Line {
  what: string
  legacy: number
  imported: number
  skipped: number
}

export interface Reconciliation {
  lines: Line[]
  agrees: boolean
}

async function count(target: Client, table: string, where = ''): Promise<number> {
  const clause = where === '' ? '' : ` where ${where}`
  const result = await target.query<{ n: string }>(`select count(*) as n from "${table}"${clause}`)
  return Number(result.rows[0]?.n ?? 0)
}

function line(what: string, legacy: number, imported: number, skipped: number): Line {
  return { what, legacy, imported, skipped }
}

function agrees(row: Line): boolean {
  return row.legacy === row.imported + row.skipped
}

export async function reconcile(
  target: Client,
  legacy: LegacyCounts,
  skipped: Record<string, number>,
): Promise<Reconciliation> {
  const lines: Line[] = [
    line('members', legacy.users, await count(target, 'user'), skipped.users ?? 0),
    line('credentials', legacy.credentials, await count(target, 'account'), 0),
    line('cards', legacy.cards, await count(target, 'cards'), skipped.cards ?? 0),
    line(
      `members with card access (permission ${CARD_ACCESS_PERMISSION})`,
      legacy.cardAccessMembers,
      await count(target, 'user', 'card_access'),
      0,
    ),
    line(
      'certifications',
      legacy.certifications,
      await count(target, 'certifications'),
      skipped.certifications ?? 0,
    ),
    line(
      'certification grants',
      legacy.userCertifications,
      await count(target, 'user_certifications'),
      skipped.user_certifications ?? 0,
    ),
    line('payments', legacy.payments, await count(target, 'payments'), skipped.payments ?? 0),
    line(
      'signed releases',
      legacy.contracts,
      await count(target, 'waivers'),
      skipped.contracts ?? 0,
    ),
  ]

  return { lines, agrees: lines.every(agrees) }
}

export function formatReconciliation(reconciliation: Reconciliation): string {
  const width = Math.max(...reconciliation.lines.map((row) => row.what.length))
  const header = `  ${'what'.padEnd(width)}     legacy  imported   skipped`
  const rows = reconciliation.lines.map((row) => {
    const mark = agrees(row) ? '' : '  DISAGREES'
    return (
      `  ${row.what.padEnd(width)}   ` +
      `${String(row.legacy).padStart(8)}  ${String(row.imported).padStart(8)}  ` +
      `${String(row.skipped).padStart(8)}${mark}`
    )
  })

  return `Reconciliation:\n${header}\n${rows.join('\n')}`
}
