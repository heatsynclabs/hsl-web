import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

/**
 * Neither jsdom nor happy-dom is in the workspace catalog, so the suites render
 * with renderToString from @vue/test-utils rather than mount. A component that
 * has to be asserted after a request therefore awaits that request in setup,
 * which the server renderer resolves before it renders.
 */
export default defineConfig({
  plugins: [vue()],
  test: {
    include: ['src/**/*.test.ts'],
  },
})
