import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
    passWithNoTests: false,
    // The 6,025-piece castle and its precomputed geometry chunks saturate the
    // default worker pool, tripping the 10s hook / 5s test timeouts in unrelated
    // suites. A small fixed pool keeps the full run deterministic.
    maxWorkers: 2,
  },
})
