import { defineConfig, devices } from '@playwright/test';

const roundDir = process.env.ROUND_DIR ?? 'test-output/local';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [
    [process.env.CI ? 'line' : 'list'],
    ['json', { outputFile: `${roundDir}/results.json` }],
    ['html', { outputFolder: `${roundDir}/report`, open: 'never' }],
  ],
  outputDir: `${roundDir}/artifacts`,
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:4100',
    testIdAttribute: 'data-test',
    locale: 'en-US',
    timezoneId: 'Asia/Taipei',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node app/server.mjs',
    url: 'http://localhost:4100/api/state',
    reuseExistingServer: !process.env.CI,
  },
});
