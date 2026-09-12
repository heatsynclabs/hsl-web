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
  port: Number(process.env.PORT ?? 3000),
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
  doorStaleSeconds: Number(process.env.DOOR_STALE_SECONDS ?? 180),

  /** The doors this building has. The adapter maps these names to hardware. */
  doors: (process.env.DOORS ?? 'front,rear').split(',').map((door) => door.trim()),
} as const

/** A session lives this long, and any request inside the last week extends it. */
export const SESSION_DAYS = 30
export const SESSION_RENEW_WITHIN_DAYS = 7

/** A command nobody claimed in this long never ran, and is recorded as expired. */
export const COMMAND_EXPIRY_SECONDS = 120

/** Ten attempts per IP and ten per email, per fifteen minutes. */
export const RATE_LIMIT = 10
export const RATE_WINDOW_MS = 15 * 60 * 1000
