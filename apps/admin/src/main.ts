import '@hsl/ui/tokens.css'
import './styles/app.css'

import { loadSession } from '@hsl/api-client'
import { createApp } from 'vue'

import { api } from './api.ts'
import App from './App.vue'
import { createAdminRouter } from './router.ts'

async function start(): Promise<void> {
  const router = createAdminRouter()

  // The guard reads the resolved session, so the one request that resolves it
  // has to finish before the first navigation is decided.
  await loadSession(api)

  const app = createApp(App)
  app.use(router)
  await router.isReady()
  app.mount('#app')
}

void start()
