import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

/**
 * Caddy serves this app under /signup and strips that prefix before it reaches
 * the file server, so the built asset URLs have to carry it. Without the base
 * the browser asks for /assets/... at the root, which is the members app.
 * See infra/Caddyfile.
 */
const API_IN_DEVELOPMENT = 'http://127.0.0.1:3000'

export default defineConfig({
  base: '/signup/',
  plugins: [vue()],
  server: {
    proxy: {
      // In production Caddy puts the apps and the API on one origin. This is
      // how development gets the same first-party session cookie.
      '/api': API_IN_DEVELOPMENT,
      '/space_api.json': API_IN_DEVELOPMENT,
    },
  },
})
