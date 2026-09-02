import { createClient } from '@hsl/api-client'

/**
 * Caddy serves the three apps and the API from one origin, so the base URL is
 * empty, the session cookie is first-party and there is no CORS anywhere.
 * See docs/architecture.md. In development Vite's proxy stands in for Caddy.
 */
export const api = createClient({ baseUrl: '' })
