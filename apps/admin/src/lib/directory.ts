import type { MemberDirectoryEntry, MemberResponse, PaymentStatus } from '@hsl/schema'
import type { PillState } from '@hsl/ui'

import { slotText } from './format.ts'

/**
 * The directory is 1,061 rows in production, and GET /api/members returns all of
 * them in one answer with no query parameters. Searching and paging therefore
 * happen here, over rows already in memory, and only one page is ever handed to
 * a table.
 *
 * Card and dues status are not in that answer. They come from the member record,
 * which this screen reads for the rows on the page being looked at. See the
 * README for why, and for the one change to the contract that would delete all
 * of this.
 */

export const PAGE_SIZE = 25

/** What one member's own record says, kept for the directory columns. */
export interface MemberSummary {
  activeSlots: number[]
  /** Every card on the record, so a deactivated one still reads as revoked. */
  cardsOnRecord: number
  holdsCard: boolean
  paymentStatus: PaymentStatus
}

export type CardFilter = 'any' | 'held' | 'none'

export interface DirectoryFilters {
  query: string
  card: CardFilter
}

export interface DirectoryRow {
  id: string
  name: string
  email: string | null
  levelText: string
  /** Slots, "none", or "revoked". Null while the member record has not been read. */
  cardText: string | null
  paymentStatus: PaymentStatus | null
}

export function summarise(record: MemberResponse): MemberSummary {
  const activeSlots = record.cards.filter((card) => card.active).map((card) => card.slot)

  return {
    activeSlots,
    cardsOnRecord: record.cards.length,
    holdsCard: activeSlots.length > 0,
    paymentStatus: record.paymentStatus,
  }
}

/** Slots read as the controller writes them, three digits, never renumbered. */
export function cardText(summary: MemberSummary): string {
  if (summary.activeSlots.length > 0) return summary.activeSlots.map(slotText).join(', ')
  // A member whose card was deactivated reads differently from one who never
  // had one, which is what the mockup's "revoked" said.
  return summary.cardsOnRecord > 0 ? 'revoked' : 'none'
}

export function matchesQuery(entry: MemberDirectoryEntry, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true

  const email = entry.email ?? ''
  return entry.name.toLowerCase().includes(needle) || email.toLowerCase().includes(needle)
}

function matchesCard(summary: MemberSummary | undefined, card: CardFilter): boolean {
  if (card === 'any') return true
  if (summary === undefined) return false
  return card === 'held' ? summary.holdsCard : !summary.holdsCard
}

export function filterMembers(
  entries: readonly MemberDirectoryEntry[],
  filters: DirectoryFilters,
  summaries: ReadonlyMap<string, MemberSummary>,
): MemberDirectoryEntry[] {
  return entries.filter(
    (entry) =>
      matchesQuery(entry, filters.query) && matchesCard(summaries.get(entry.id), filters.card),
  )
}

export function pageCount(total: number, size: number = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size))
}

export function pageOf<Row>(rows: readonly Row[], page: number, size: number = PAGE_SIZE): Row[] {
  const first = (page - 1) * size
  return rows.slice(first, first + size)
}

export function toRow(
  entry: MemberDirectoryEntry,
  summaries: ReadonlyMap<string, MemberSummary>,
): DirectoryRow {
  const summary = summaries.get(entry.id)

  return {
    id: entry.id,
    name: entry.name,
    email: entry.email,
    levelText: entry.memberLevelLabel ?? 'not recorded',
    cardText: summary === undefined ? null : cardText(summary),
    paymentStatus: summary?.paymentStatus ?? null,
  }
}

const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  paid: 'Paid',
  lapsed: 'Lapsed',
  'not-applicable': 'No dues',
}

export function paymentLabel(status: PaymentStatus): string {
  return PAYMENT_LABEL[status]
}

export function paymentPill(status: PaymentStatus): PillState {
  if (status === 'paid') return 'on'
  return status === 'lapsed' ? 'off' : 'dim'
}
