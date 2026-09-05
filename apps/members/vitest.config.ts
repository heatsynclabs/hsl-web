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
    /**
     * lib/auth.test.ts imports the better-auth client inside each test, because
     * the client captures globalThis.fetch when it is built and the suite has to
     * stand up its fetch first. See decisions/0012. That import is charged to
     * the test's own timeout, and with the three app suites starting jsdom at
     * once it went past the five second default in two full runs out of three.
     * A gate that fails on a busy machine is one people learn to re-run.
     */
    testTimeout: 30_000,
  },
})
