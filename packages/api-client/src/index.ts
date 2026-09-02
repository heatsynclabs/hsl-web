/**
 * The public surface of @hsl/api-client. Apps import from here and nothing else.
 */

export { createClient } from './client.ts'
export type { ApiClient, ClientOptions } from './client.ts'

export { ApiError } from './errors.ts'

export { clearSession, loadSession, refreshSession, useSession } from './session.ts'
export type { Session, SessionState, SessionStatus } from './session.ts'
