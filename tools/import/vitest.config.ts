import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['**/*.test.ts'],
    globalSetup: ['./test-support/global-setup.ts'],
    // Both databases are shared, so two files never rebuild each other's rows.
    fileParallelism: false,
  },
})
