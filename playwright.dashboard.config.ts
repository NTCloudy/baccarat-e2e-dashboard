import { defineConfig, devices } from '@playwright/test';
import { SITE } from './dashboard-tests/fixtures/site';

/**
 * Tests of the results dashboard (dashboard/), separate from the E2E suite in
 * playwright.config.ts. The site is built from the small fixture history in
 * dashboard-tests/fixtures/data and served locally; the GitHub API is mocked,
 * so the tests never reach the network.
 *
 *   npm run test:dashboard
 */
const CI = Boolean(process.env.CI);
const baseURL = `http://localhost:${SITE.port}/`;

export default defineConfig({
  testDir: './dashboard-tests',
  fullyParallel: true,
  forbidOnly: CI,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [[CI ? 'line' : 'list'], ['html', { outputFolder: 'test-output/dashboard-report', open: 'never' }]],
  outputDir: 'test-output/dashboard-artifacts',
  use: {
    baseURL,
    // The dashboard picks its language from the browser: Traditional Chinese is its main audience.
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: [
      `node scripts/build-site.mjs --data-dir ${SITE.dataDir} --out ${SITE.dir}`,
      `node scripts/serve.mjs --dir ${SITE.dir} --port ${SITE.port}`,
    ].join(' && '),
    url: `${baseURL}catalog.json`,
    reuseExistingServer: !CI,
    timeout: 120_000,
  },
});
