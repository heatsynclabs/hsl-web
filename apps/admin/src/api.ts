import { createClient } from '@hsl/api-client'

/**
 * Caddy serves this app and proxies the API on one origin, so the base URL is
 * empty and the session cookie is a plain first-party cookie.
 */
export const api = createClient({ baseUrl: '' })
