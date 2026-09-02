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

const SECRET_NAMES = ['AUTH_SECRET', 'DOOR_TOKEN', 'DATABASE_PASSWORD'] as const

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
  }
}
