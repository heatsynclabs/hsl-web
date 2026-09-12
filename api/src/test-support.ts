import { hashPassword, resetRateLimit } from './auth.ts'
import { sql } from './db.ts'

/**
 * What the suites need and nothing more. Not a .test.ts, so the runner does not
 * collect it.
 *
 * Tests run against a real Postgres from compose rather than a stubbed query
 * builder, because most of what is worth testing here is a refusal expressed in
 * SQL: a foreign key, a unique index, an append-only trigger, a transaction
 * that has to roll two writes back together.
 */

const TABLES = [
  'door_placements',
  'door_commands',
  'door_state',
  'door_events',
  'audit_log',
  'waivers',
  'payments',
  'member_certifications',
  'certifications',
  'credentials',
  'service_tokens',
  'sessions',
  'members',
]

export async function reset(): Promise<void> {
  await sql.unsafe(`truncate ${TABLES.join(', ')} restart identity cascade`)
  resetRateLimit()
}

export interface NewMember {
  email?: string
  name?: string
  password?: string
  roles?: string[]
  status?: string
  oriented?: boolean
  doorAccess?: boolean
}

export async function makeMember(fields: NewMember = {}): Promise<{ id: string; email: string }> {
  const email = fields.email ?? `member-${Math.random().toString(36).slice(2)}@example.invalid`
  const [row] = await sql<Array<{ id: string; email: string }>>`
    insert into members (email, name, password, roles, status, oriented, door_access)
    values (${email}, ${fields.name ?? 'Test Member'},
            ${await hashPassword(fields.password ?? 'correct-horse-battery')},
            ${fields.roles ?? []}, ${fields.status ?? 'active'},
            ${fields.oriented ?? false}, ${fields.doorAccess ?? false})
    returning id, email`
  return row as { id: string; email: string }
}

/** The session cookie a sign in hands back, ready to put on the next request. */
export async function signIn(
  app: { fetch: (request: Request) => Response | Promise<Response> },
  email: string,
  password = 'correct-horse-battery',
): Promise<string> {
  const answer = await app.fetch(
    new Request('http://localhost/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }),
  )
  if (answer.status !== 200) throw new Error(`sign in answered ${answer.status}`)

  const cookie = answer.headers.get('set-cookie') ?? ''
  return cookie.slice(0, cookie.indexOf(';'))
}

export interface CallOptions {
  method?: string
  cookie?: string
  bearer?: string
  controller?: string
  body?: unknown
}

export function call(
  app: { fetch: (request: Request) => Response | Promise<Response> },
  path: string,
  options: CallOptions = {},
): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (options.cookie !== undefined) headers.cookie = options.cookie
  if (options.bearer !== undefined) headers.authorization = `Bearer ${options.bearer}`
  if (options.controller !== undefined) headers['x-controller-id'] = options.controller

  const method = options.method ?? 'GET'
  const sendsBody = method !== 'GET' && method !== 'HEAD' && options.body !== undefined

  return Promise.resolve(
    app.fetch(
      new Request(`http://localhost${path}`, {
        method,
        headers,
        body: sendsBody ? JSON.stringify(options.body) : undefined,
      }),
    ),
  )
}

/** A service token row plus the bearer value that opens it. */
export async function makeServiceToken(id = 'door-test', scopes = ['door']): Promise<string> {
  const secret = 'a-secret-nobody-uses-in-production'
  await sql`
    insert into service_tokens (id, name, secret_hash, scopes)
    values (${id}, ${id}, ${await hashPassword(secret)}, ${scopes})`
  return `${id}.${secret}`
}

export async function stop(): Promise<void> {
  await sql.end()
}
