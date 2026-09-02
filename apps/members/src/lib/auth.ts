/**
 * Sign in, sign out and password reset. These are better-auth's own routes,
 * mounted at /api/auth by services/api/src/app.ts, and @hsl/api-client
 * deliberately does not carry them.
 *
 * better-auth ships a Vue client at its `better-auth/vue` export and that is
 * what should be here. It is not a dependency of this app, so it does not
 * resolve, and adding one is outside what this change may touch. The three
 * paths and their bodies below were read from the installed better-auth 1.7.2
 * sources rather than from memory:
 *   dist/api/routes/sign-in.mjs        /sign-in/email  { email, password }
 *   dist/api/routes/sign-out.mjs       /sign-out
 *   dist/api/routes/password.mjs       /request-password-reset  { email, redirectTo }
 * A refusal comes back as the better-call APIError body, { message, code },
 * with the HTTP status.
 */

const BASE_PATH = '/api/auth'

/** better-auth answers 401 with this code when either the email or the password is wrong. */
const INVALID_CREDENTIALS = 'INVALID_EMAIL_OR_PASSWORD'

export class AuthError extends Error {
  /** Zero when no response arrived at all. */
  readonly status: number
  /** better-auth's own code, when it sent one. */
  readonly code: string | null

  constructor(message: string, status: number, code: string | null) {
    super(message)
    this.name = 'AuthError'
    this.status = status
    this.code = code
  }
}

interface Refusal {
  message: string | null
  code: string | null
}

function readRefusal(body: unknown): Refusal {
  if (typeof body !== 'object' || body === null) return { message: null, code: null }
  const fields = body as Record<string, unknown>
  return {
    message: typeof fields['message'] === 'string' ? fields['message'] : null,
    code: typeof fields['code'] === 'string' ? fields['code'] : null,
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text === '') return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function post(path: string, body: Record<string, unknown>): Promise<unknown> {
  let response: Response
  try {
    response = await globalThis.fetch(BASE_PATH + path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new AuthError(
      'The sign in service did not answer. Nothing was sent. Check that this browser is on a network that can reach the site, then try again.',
      0,
      null,
    )
  }

  const answer = await readJson(response)
  if (response.ok) return answer

  const refusal = readRefusal(answer)
  throw new AuthError(explain(response.status, refusal), response.status, refusal.code)
}

function explain(status: number, refusal: Refusal): string {
  if (refusal.code === INVALID_CREDENTIALS) {
    return 'That email and password do not match an account. You are not signed in. Check both, or use the password reset link.'
  }
  const said = refusal.message === null ? '' : ` ${refusal.message}.`
  return `The request was refused with ${status}.${said} Nothing was changed. Try again, and tell an admin if it keeps happening.`
}

export async function signIn(email: string, password: string): Promise<void> {
  await post('/sign-in/email', { email, password })
}

export async function signOut(): Promise<void> {
  await post('/sign-out', {})
}

/**
 * Returns better-auth's own sentence, which is the same whether or not the
 * address is on an account. Printing it as it comes keeps this screen from
 * telling somebody which emails exist. redirectTo is left off because this app
 * has no screen for the second half of the flow yet.
 */
export async function requestPasswordReset(email: string): Promise<string> {
  const answer = await post('/request-password-reset', { email })
  const message = readRefusal(answer).message
  return message ?? 'If that address is on an account, a reset link is on its way.'
}
