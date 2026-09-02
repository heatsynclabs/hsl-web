import type { ApiClient } from '@hsl/api-client'
import { createClient } from '@hsl/api-client'
import type { InjectionKey } from 'vue'
import { inject } from 'vue'

/**
 * Caddy serves this app at the site root and proxies /api and /space_api.json
 * to the API from the same origin, so the base URL is the empty string and
 * there is no CORS. infra/Caddyfile is where that is arranged.
 */
export const api: ApiClient = createClient({ baseUrl: '' })

export const apiKey: InjectionKey<ApiClient> = Symbol('hsl.api')

/**
 * Views ask for the client rather than importing the singleton, so a test can
 * hand one a stub without touching module state. main.ts provides the real one.
 */
export function useApi(): ApiClient {
  const client = inject(apiKey)
  if (client === undefined) {
    throw new Error('No API client was provided. main.ts provides it, and a test must too.')
  }
  return client
}
