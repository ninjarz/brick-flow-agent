import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: '**/performance/**',
  fullyParallel: true,
  workers: process.env.CI ? 1 : 2,
  retries: process.env.CI ? 1 : 0,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4174/brick-flow-agent/',
    channel: 'chromium',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4174',
    url: 'http://127.0.0.1:4174/brick-flow-agent/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
