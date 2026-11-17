import { defineConfig } from 'vitest/config'
import { getConstructionPhysicsRevision } from './server/constructionPhysicsRevision'

export default defineConfig({
  define: { __CONSTRUCTION_PHYSICS_REVISION__: JSON.stringify(getConstructionPhysicsRevision(process.cwd())) },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
    passWithNoTests: false,
    // Geometry-heavy suites share the CPU quota on hosted CI runners.
    maxWorkers: process.env.CI ? 1 : 2,
  },
})
