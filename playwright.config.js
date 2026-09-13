import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:5419',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://127.0.0.1:5419',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: 'chromium-phone', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    { name: 'webkit-phone', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
})
