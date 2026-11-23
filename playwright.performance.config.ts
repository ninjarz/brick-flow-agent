import { defineConfig } from '@playwright/test'
import config from './playwright.config'

const url = 'http://127.0.0.1:4188/brick-flow-agent/'

export default defineConfig({
  ...config,
  testDir: './e2e',
  workers: 1,
  outputDir: 'test-results/hogwarts-performance',
  use: { ...config.use, baseURL: url },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4188 --strictPort',
    url,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
