import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

/**
 * Caddy serves this app under /admin and strips the prefix before the files are
 * read, so the built asset URLs have to carry it back. See infra/Caddyfile.
 */
export default defineConfig({
  base: '/admin/',
  plugins: [vue()],
  server: {
    // In production Caddy serves the apps and proxies the API on one origin, so
    // the client's base URL is empty and nothing here is cross origin. In
    // development Vite is the origin, so it has to forward the same two paths.
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/space_api.json': 'http://127.0.0.1:3000',
    },
  },
})
