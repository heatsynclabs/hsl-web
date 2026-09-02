import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    globalSetup: ['./src/test-support/global-setup.ts'],
    // One Postgres, one schema, one set of tables. Files run one at a time so
    // two of them never truncate each other's rows mid-test.
    fileParallelism: false,
  },
})
