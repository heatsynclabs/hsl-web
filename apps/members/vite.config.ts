import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

/**
 * In production Caddy serves this app at the site root and proxies /api and
 * /space_api.json to the API from the same origin, so the client's base URL is
 * the empty string and there is no CORS anywhere. The proxy below is what makes
 * that true in development too, where Vite is on another port.
 */
export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false },
      '/space_api.json': { target: 'http://127.0.0.1:3000', changeOrigin: false },
    },
  },
})
