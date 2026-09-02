import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

/**
 * jsdom so a suite can click. Suites that only read markup still use
 * renderToString, which says plainly that nothing is being interacted with.
 * See docs/decisions/0011-a-dom-for-the-vue-suites.md.
 */
export default defineConfig({
  plugins: [vue()],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'jsdom',
    setupFiles: ['./src/test-support/setup.ts'],
  },
})
