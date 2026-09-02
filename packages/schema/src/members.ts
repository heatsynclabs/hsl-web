/**
 * Domain rules that turn stored values into what a person reads. They live here
 * once so the API, the apps and the import cannot disagree about them.
 */

export const paymentStatuses = ['paid', 'lapsed', 'not-applicable'] as const
export type PaymentStatus = (typeof paymentStatuses)[number]

/**
 * The bands in app/models/user.rb of the Rails members app. A level outside
 * them has no label there, so it has none here either: 27 legacy rows are null
 * and nothing in production sits in the gaps.
 */
const MEMBER_LEVEL_BANDS: ReadonlyArray<{ min: number; max: number; label: string }> = [
  { min: 0, max: 0, label: 'None' },
  { min: 1, max: 1, label: 'Unable' },
  { min: 10, max: 24, label: 'Volunteer' },
  { min: 25, max: 49, label: 'Associate ($25)' },
  { min: 50, max: 99, label: 'Basic ($50)' },
  { min: 100, max: 999, label: 'Plus ($100)' },
]

export function memberLevelLabel(level: number | null): string | null {
  if (level === null) return null

  for (const band of MEMBER_LEVEL_BANDS) {
    if (level >= band.min && level <= band.max) return band.label
  }

  return null
}

// Rails treats dues as current while the most recent payment is inside this window.
const DUES_WINDOW_DAYS = 60
const DUES_WINDOW_MS = DUES_WINDOW_DAYS * 24 * 60 * 60 * 1000

// Below 25 a member pays no dues, so there is nothing to be lapsed about.
const LOWEST_PAYING_LEVEL = 25
const HIGHEST_PAYING_LEVEL = 999

export function paymentStatus(
  memberLevel: number | null,
  mostRecentPaymentDate: Date | null,
  now: Date,
): PaymentStatus {
  if (memberLevel === null) return 'not-applicable'
  if (memberLevel < LOWEST_PAYING_LEVEL || memberLevel > HIGHEST_PAYING_LEVEL) {
    return 'not-applicable'
  }
  if (mostRecentPaymentDate === null) return 'lapsed'

  const elapsed = now.getTime() - mostRecentPaymentDate.getTime()
  return elapsed <= DUES_WINDOW_MS ? 'paid' : 'lapsed'
}
