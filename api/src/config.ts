/**
 * Every environment variable this service reads, its default, and the case
 * where a missing value stops the process. Nothing else in the API reads
 * process.env.
 */

const issuer = process.env.ISSUER ?? 'http://localhost:3000'

/** True for a real deployment. Drives the refusals below and the cookie flags. */
const public_ = issuer.startsWith('https://')

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set, so the API did not start. Set it and start again.`)
  }
  return value
}

/**
 * A whole number, or the process does not start.
 *
 * Number('abc') is NaN, and every comparison against NaN is false. A
 * DOOR_STALE_SECONDS nobody typed correctly would make `stale` permanently
 * false, and a member told the front door is unlocked on the strength of a
 * reading that never happened is worse than a member told nothing.
 */
function count(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback

  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} is ${raw}, which is not a whole number of seconds. The API did not start.`)
  }
  return value
}

function requiredInPublic(name: string): string | null {
  const value = process.env[name]
  if (value !== undefined && value !== '') return value
  if (!public_) return null
  throw new Error(
    `${name} is not set and ISSUER is https, so the API did not start. A deployment that ` +
      'cannot send mail cannot reset a password, and a member locked out has no other way in.',
  )
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  port: count('PORT', 3000),
  issuer,
  public: public_,

  /**
   * The apex domain, so one session covers every HeatSync app on a subdomain.
   * Empty means a host-only cookie, which is what a laptop wants.
   */
  cookieDomain: process.env.COOKIE_DOMAIN ?? '',

  /** RSA PEM. Absent off https, an ephemeral key is generated at startup. */
  signingKey: requiredInPublic('SIGNING_KEY'),
  signingKeyPublic: requiredInPublic('SIGNING_KEY_PUBLIC'),

  smtpUrl: requiredInPublic('SMTP_URL'),
  mailFrom: process.env.MAIL_FROM ?? 'HeatSync Labs <noreply@heatsynclabs.org>',

  /** Where the emailed link points. The form that posts to /api/reset lives here. */
  resetUrl: process.env.RESET_URL ?? `${issuer}/reset`,

  /**
   * Appended to a password before bcrypt verification. Empty reduces that to
   * plain bcrypt at no cost. It exists so that a pepper found later in the
   * legacy configuration is a config change rather than a forced reset for a
   * thousand people.
   */
  pepper: process.env.PEPPER ?? '',

  /** Older than this and door state is reported as stale rather than as fact. */
  doorStaleSeconds: count('DOOR_STALE_SECONDS', 180),

  /** The doors this building has. The adapter maps these names to hardware. */
  doors: doorNames(),
} as const

/** At least one, none of them empty. `DOORS=` would otherwise mean one door with no name. */
function doorNames(): string[] {
  const names = (process.env.DOORS ?? 'front,rear')
    .split(',')
    .map((door) => door.trim())
    .filter((door) => door !== '')

  if (names.length === 0) {
    throw new Error('DOORS is empty, so this building has no doors. The API did not start.')
  }
  return names
}

/** A session lives this long, and any request inside the last week extends it. */
export const SESSION_DAYS = 30
export const SESSION_RENEW_WITHIN_DAYS = 7

/** A command nobody claimed in this long never ran, and is recorded as expired. */
export const COMMAND_EXPIRY_SECONDS = 120

/** Ten attempts per IP and ten per email, per fifteen minutes. */
export const RATE_LIMIT = 10
export const RATE_WINDOW_MS = 15 * 60 * 1000
