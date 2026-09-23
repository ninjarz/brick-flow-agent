import { defineConfig, devices } from '@playwright/test'

const basePath = process.env.PLAYWRIGHT_BASE_PATH ?? '/brick-flow-agent/'
export default defineConfig({
  testDir: './tests/production',
  workers: 1,
  testIgnore: '**/soak.spec.ts',
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chromium' } }, { name: 'webkit', use: { ...devices['Desktop Safari'], channel: undefined } }],
  reporter: 'line',
  use: { baseURL: `http://127.0.0.1:4175${basePath}`, trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4175',
    url: `http://127.0.0.1:4175${basePath}`,
    reuseExistingServer: false,
  },
})
