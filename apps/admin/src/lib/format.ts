/**
 * Turning stored values into what an admin reads. Dates print in the browser's
 * own zone because the lab reads these screens standing in the lab.
 */

const DATE_ONLY = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

const DATE_AND_TIME = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

/** An ISO timestamp from the API. Anything unparseable prints as itself. */
export function whenText(iso: string | null): string {
  if (iso === null) return 'never'

  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? iso : DATE_AND_TIME.format(at)
}

export function dayText(iso: string | null): string {
  if (iso === null) return 'never'

  // A date only value has no zone, so it is read as UTC and would print as the
  // day before for anyone west of Greenwich. Splitting it keeps the day.
  const parts = iso.slice(0, 10).split('-')
  const [year, month, day] = [Number(parts[0]), Number(parts[1]), Number(parts[2])]
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return iso

  return DATE_ONLY.format(new Date(year, month - 1, day))
}

/** The controller indexes slots 0 through 199, and the lab writes them padded. */
export function slotText(slot: number): string {
  return String(slot).padStart(3, '0')
}

export function moneyText(amountCents: number): string {
  return `$${(amountCents / 100).toFixed(2)}`
}

/** Reads what a person typed into an amount box. Returns null when it is not money. */
export function centsFromInput(typed: string): number | null {
  const trimmed = typed.trim().replace(/^\$/, '')
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null

  const cents = Math.round(Number(trimmed) * 100)
  return cents > 0 ? cents : null
}

/** The two initials the avatar shows beside a name. */
export function initialsOf(name: string): string {
  const words = name.split(/\s+/).filter((word) => word.length > 0)
  const first = words[0]?.[0] ?? '?'
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : ''
  return (first + last).toUpperCase()
}

/** An ISO timestamp as the local day a date input wants. */
export function dateInputValue(iso: string | null): string {
  if (iso === null) return ''

  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''

  const month = String(at.getMonth() + 1).padStart(2, '0')
  const day = String(at.getDate()).padStart(2, '0')
  return `${at.getFullYear()}-${month}-${day}`
}

/**
 * The local day a date input gave back, as the ISO timestamp the contract wants.
 * Local midnight, because orientation happened at the lab on that day.
 */
export function isoFromDateInput(day: string): string | null {
  if (day === '') return null

  const at = new Date(`${day}T00:00:00`)
  return Number.isNaN(at.getTime()) ? null : at.toISOString()
}

/**
 * A card number as the controller stores it. Legacy numbers are five, six or
 * seven hex characters and Rails padded with rjust(8, '0') before writing the
 * device, so the same padding happens here or a short number lands in a
 * different slot value. See docs/legacy-system.md.
 */
export function padCardNumber(typed: string): string {
  return typed.trim().toUpperCase().padStart(8, '0')
}
