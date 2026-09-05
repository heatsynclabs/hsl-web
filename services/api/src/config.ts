import { readFileSync } from 'node:fs'

import { z } from 'zod'

/**
 * Every environment variable the service reads, parsed once at boot. A missing
 * or malformed value stops the process with a list of what to fix, rather than
 * failing on the first request that happens to need it.
 *
 * Compose passes secrets as files under /run/secrets, so each secret is
 * accepted either as NAME or as NAME_FILE holding the value.
 */

const DEFAULT_PORT = 3000

/**
 * How long the last door report stays trustworthy. Remote control answers 503
 * past this point and the public status reads closed rather than stale-open.
 *
 * ASSUMPTION: the door service posts at least once a minute, so two minutes is
 * two missed posts.
 * CONFIRM BY: reading the poll interval in services/door once it exists.
 * BLAST RADIUS: a door service that polls more slowly would make remote control
 * refuse commands it should have queued.
 */
const DEFAULT_DOOR_STATUS_STALE_SECONDS = 120

const SECRET_NAMES = ['AUTH_SECRET', 'DOOR_TOKEN', 'DATABASE_PASSWORD', 'SMTP_URL'] as const

/**
 * The host `make secrets` writes into secrets/smtp_url, which is the compose
 * service name of the development mail catcher. It resolves nowhere else, so
 * refusing it on a real deployment has no false positive.
 */
const MAIL_CATCHER_HOST = 'mail'

/** The schemes nodemailer 9.1.1 understands, read from lib/shared/index.js. */
const SMTP_SCHEMES = ['smtp:', 'smtps:']

function isSmtpUrl(value: string): boolean {
  const url = URL.parse(value)
  return url !== null && SMTP_SCHEMES.includes(url.protocol) && url.hostname !== ''
}

const environmentSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_PASSWORD: z.string().min(1).optional(),
  PUBLIC_ORIGIN: z.url(),
  PORT: z.coerce.number().int().min(1).max(65535).default(DEFAULT_PORT),
  AUTH_SECRET: z.string().min(16),
  DOOR_TOKEN: z.string().min(16),
  LEGACY_PEPPER: z.string().default(''),
  DOOR_STATUS_STALE_SECONDS: z.coerce
    .number()
    .int()
    .min(1)
    .default(DEFAULT_DOOR_STATUS_STALE_SECONDS),
  SPACE_API_TEMPLATE_PATH: z.string().min(1).optional(),
  // Checked here rather than accepted as any non-empty string. nodemailer
  // 9.1.1's parseConnectionUrl recognises smtp:, smtps: and direct: and
  // silently ignores every other scheme, leaving a transport with no host that
  // fails at the first send rather than at boot. The message never carries the
  // value, because the value carries the relay password.
  SMTP_URL: z
    .string()
    .min(1)
    .refine(isSmtpUrl, 'must be an smtp:// or smtps:// URL with a host name')
    .optional(),
  MAIL_FROM: z.string().default('HeatSync Labs <noreply@heatsynclabs.org>'),
})

export interface Config {
  port: number
  databaseUrl: string
  publicOrigin: string
  authSecret: string
  doorToken: string
  legacyPepper: string
  useSecureCookies: boolean
  doorStatusStaleSeconds: number
  spaceApiTemplatePath: string | null
  smtpUrl: string | null
  mailFrom: string
}

type Environment = Record<string, string | undefined>

/** Reads NAME, or the contents of the file named by NAME_FILE. */
function resolveSecrets(environment: Environment): Environment {
  const resolved: Environment = { ...environment }

  for (const name of SECRET_NAMES) {
    const path = environment[`${name}_FILE`]
    if (path === undefined || environment[name] !== undefined) continue

    try {
      resolved[name] = readFileSync(path, 'utf8').trim()
    } catch (cause) {
      throw new Error(`${name}_FILE names ${path}, which could not be read.`, { cause })
    }
  }

  return resolved
}

function pointsAtTheMailCatcher(smtpUrl: string | undefined): boolean {
  if (smtpUrl === undefined) return false
  return URL.parse(smtpUrl)?.hostname === MAIL_CATCHER_HOST
}

/**
 * pg lets the connection string win over an explicit password, so the password
 * goes into the string rather than beside it.
 */
function connectionStringWithPassword(databaseUrl: string, password: string | undefined): string {
  if (password === undefined) return databaseUrl

  const url = new URL(databaseUrl)
  url.password = password
  return url.toString()
}

function describeFailure(error: z.ZodError): string {
  const lines = error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
  return [
    'The API cannot start because its configuration is incomplete.',
    'Fix these environment variables and start it again:',
    ...lines,
  ].join('\n')
}

export function loadConfig(environment: Environment = process.env): Config {
  const parsed = environmentSchema.safeParse(resolveSecrets(environment))
  if (!parsed.success) throw new Error(describeFailure(parsed.error))

  const values = parsed.data

  // Password reset is the only way in for the 31 imported members who have no
  // password hash, and for anyone who forgets theirs. A deployment that cannot
  // send mail locks those people out, so it fails here rather than at the
  // moment somebody first asks for a link. https is the signal that this is a
  // real deployment rather than a laptop.
  if (values.PUBLIC_ORIGIN.startsWith('https://') && values.SMTP_URL === undefined) {
    throw new Error(
      'SMTP_URL is not set, so password reset mail cannot be sent and a member who forgets ' +
        'their password has no way back in. Set SMTP_URL, or SMTP_URL_FILE naming a file that ' +
        'holds it. The API did not start.',
    )
  }

  // A deployment that kept the placeholder answers every reset request with
  // success and posts the mail into a web inbox nobody reads, which is worse
  // than refusing to start: the 31 imported members who have never had a
  // password are locked out with nothing in any log to say so.
  if (values.PUBLIC_ORIGIN.startsWith('https://') && pointsAtTheMailCatcher(values.SMTP_URL)) {
    throw new Error(
      'SMTP_URL still points at the development mail catcher, so every password reset would be ' +
        'delivered to an inbox nobody reads and the members who need reset would be locked out. ' +
        'Put a real SMTP URL in secrets/smtp_url. The API did not start.',
    )
  }

  return {
    port: values.PORT,
    databaseUrl: connectionStringWithPassword(values.DATABASE_URL, values.DATABASE_PASSWORD),
    publicOrigin: values.PUBLIC_ORIGIN,
    authSecret: values.AUTH_SECRET,
    doorToken: values.DOOR_TOKEN,
    legacyPepper: values.LEGACY_PEPPER,
    // The session cookie is first-party on one origin, so https is the only
    // thing that decides whether Secure can be set.
    useSecureCookies: values.PUBLIC_ORIGIN.startsWith('https://'),
    doorStatusStaleSeconds: values.DOOR_STATUS_STALE_SECONDS,
    spaceApiTemplatePath: values.SPACE_API_TEMPLATE_PATH ?? null,
    smtpUrl: values.SMTP_URL ?? null,
    mailFrom: values.MAIL_FROM,
  }
}
