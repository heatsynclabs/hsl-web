/**
 * Dates as a member reads them. The options live here once so two screens
 * cannot drift into printing the same value two ways.
 */

const DAY: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' }
const TIME: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' }

/** The length of an ISO calendar date, which the contract uses for payments.paidOn. */
const DATE_ONLY_LENGTH = 10

/**
 * A calendar date carries no time zone, so it is formatted in UTC. Read in
 * Arizona, which is seven hours behind, a date-only value formatted locally
 * prints the day before.
 */
export function formatDay(iso: string): string {
  const dateOnly = iso.length === DATE_ONLY_LENGTH
  const value = new Date(dateOnly ? `${iso}T00:00:00Z` : iso)
  if (Number.isNaN(value.getTime())) return iso

  return value.toLocaleDateString(undefined, dateOnly ? { ...DAY, timeZone: 'UTC' } : DAY)
}

export function formatTimeOfDay(iso: string): string {
  const value = new Date(iso)
  if (Number.isNaN(value.getTime())) return iso

  return value.toLocaleTimeString(undefined, TIME).toLowerCase()
}
