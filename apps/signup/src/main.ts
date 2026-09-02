import '@hsl/ui/tokens.css'
import './styles/app.css'

import { loadSession } from '@hsl/api-client'
import { createApp } from 'vue'
import { createWebHistory } from 'vue-router'

import { api } from './api.ts'
import App from './App.vue'
import { createJoinRouter } from './router.ts'

/**
 * The session is fetched once here, before the router is ready, so the guard
 * reads a resolved answer instead of racing the first navigation.
 */
async function start(): Promise<void> {
  await loadSession(api)

  const router = createJoinRouter(createWebHistory(import.meta.env.BASE_URL))
  const app = createApp(App).use(router)

  await router.isReady()
  app.mount('#app')
}

void start()
