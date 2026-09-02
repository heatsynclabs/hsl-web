import type { PillState } from '@hsl/ui'

import { moneyText, slotText } from './format.ts'

/**
 * Reading the append-only log. The action slug and the detail object are written
 * by whichever route did the work, so nothing here assumes a shape: a detail key
 * this file has never seen still prints as itself.
 */

/** Amber for a change that hands out access, faded for one that takes it away. */
export function actionState(action: string): PillState {
  if (action.endsWith('.refused') || action.endsWith('.revoke')) return 'off'
  if (action === 'card.assign' || action === 'certification.grant') return 'on'
  return 'dim'
}

function valueText(key: string, value: unknown): string {
  if (value === null) return 'none'
  if (key === 'amountCents' && typeof value === 'number') return moneyText(value)
  if (key === 'slot' && typeof value === 'number') return slotText(value)
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return JSON.stringify(value)
}

function pairsText(detail: Record<string, unknown>): string {
  return Object.entries(detail)
    .map(([key, value]) => `${key} ${valueText(key, value)}`)
    .join(', ')
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/**
 * PATCH /api/members/:id writes what changed and what it was before, which is
 * the pair an admin reading the log after a mistake actually needs.
 */
function changeText(detail: Record<string, unknown>): string {
  const changed = asRecord(detail['changed'])
  if (changed === null) return pairsText(detail)

  const previous = asRecord(detail['previous']) ?? {}
  return Object.entries(changed)
    .map(([key, value]) => `${key} ${valueText(key, value)}, was ${valueText(key, previous[key])}`)
    .join('; ')
}

export function detailText(action: string, detail: Record<string, unknown> | null): string {
  if (detail === null) return ''
  return action === 'member.update' ? changeText(detail) : pairsText(detail)
}

/**
 * The log stores a member id. Names come from the directory, which leaves out
 * members who hide themselves, so the id is the honest fallback rather than a
 * blank cell.
 */
export function targetText(targetId: string | null, names: ReadonlyMap<string, string>): string {
  if (targetId === null) return 'the system'
  return names.get(targetId) ?? targetId
}
