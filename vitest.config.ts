import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
    passWithNoTests: false,
    // Geometry-heavy suites share the CPU quota on hosted CI runners.
    maxWorkers: process.env.CI ? 1 : 2,
  },
})
