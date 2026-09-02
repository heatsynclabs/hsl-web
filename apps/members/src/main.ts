import { loadSession } from '@hsl/api-client'
import '@hsl/ui/tokens.css'
import { createApp } from 'vue'

import App from './App.vue'
import { api, apiKey } from './lib/api'
import { createAppRouter } from './router'

/**
 * The session is resolved once, here, before the router is ready. Every guard
 * and every screen then reads a value that is already settled instead of each
 * one asking GET /api/me again.
 */
async function start(): Promise<void> {
  await loadSession(api)

  const router = createAppRouter()
  const app = createApp(App)
  app.provide(apiKey, api)
  app.use(router)

  await router.isReady()
  app.mount('#app')
}

// A rejected bootstrap would leave an empty page, which tells a member nothing.
void start().catch((error: unknown) => {
  console.error('[members] the app did not start', error)
  const root = document.getElementById('app')
  if (root !== null) {
    root.textContent =
      'This app did not start and nothing was changed. Reload the page, and tell an admin if it keeps happening.'
  }
})
