import { createAuthClient } from 'better-auth/vue'

/**
 * Sign in, sign out and password reset. These are better-auth's own routes,
 * mounted at /api/auth by services/api/src/app.ts, and @hsl/api-client
 * deliberately does not carry them.
 *
 * The client is better-auth's own, so the paths and body shapes are the
 * library's to keep true rather than ours. Read from the installed better-auth
 * 1.7.2 sources: dist/client/config.mjs defaults baseURL to /api/auth on this
 * origin and sends credentials, which is what Caddy serving one origin makes
 * possible.
 *
 * The functions below exist because the client answers in two shapes and the
 * screens should read one. A refusal comes back as a value,
 * { data: null, error: { status, statusText, message, code } }, and a request
 * that never reached the server throws. Both leave here as an AuthError.
 */
const client = createAuthClient()

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

interface Answer {
  data: unknown
  error: { status?: number; message?: string; code?: string } | null
}

function explain(status: number, message: string | undefined, code: string | undefined): string {
  if (code === INVALID_CREDENTIALS) {
    return 'That email and password do not match an account. You are not signed in. Check both, or use the password reset link.'
  }
  const said = message === undefined || message === '' ? '' : ` ${message}.`
  return `The request was refused with ${status}.${said} Nothing was changed. Try again, and tell an admin if it keeps happening.`
}

async function answered(call: Promise<Answer>): Promise<unknown> {
  let answer: Answer
  try {
    answer = await call
  } catch {
    throw new AuthError(
      'The sign in service did not answer. Nothing was sent. Check that this browser is on a network that can reach the site, then try again.',
      0,
      null,
    )
  }

  if (answer.error === null) return answer.data

  const status = answer.error.status ?? 0
  throw new AuthError(explain(status, answer.error.message, answer.error.code), status, answer.error.code ?? null)
}

/** The message better-auth put in a body, when it put one there. */
function messageIn(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const said = (body as Record<string, unknown>)['message']
  return typeof said === 'string' ? said : null
}

export async function signIn(email: string, password: string): Promise<void> {
  await answered(client.signIn.email({ email, password }))
}

export async function signOut(): Promise<void> {
  await answered(client.signOut())
}

/**
 * Returns better-auth's own sentence, which is the same whether or not the
 * address is on an account. Printing it as it comes keeps this screen from
 * telling somebody which emails exist.
 */
export async function requestPasswordReset(email: string): Promise<string> {
  // redirectTo is where better-auth sends somebody after it has checked the
  // token in the emailed link. It appends ?token= to this path, and
  // ResetPasswordView reads it. Without it the link lands nowhere.
  const answer = await answered(
    client.requestPasswordReset({
      email,
      redirectTo: `${globalThis.location?.origin ?? ''}/reset-password`,
    }),
  )

  return messageIn(answer) ?? 'If that address is on an account, a reset link is on its way.'
}

/**
 * Sets a new password from the token in the emailed link.
 *
 * This is the second half of the reset. Without it the 31 imported members who
 * have never had a password could ask for a link and then had nowhere to go.
 */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  await answered(client.resetPassword({ token, newPassword }))
}
