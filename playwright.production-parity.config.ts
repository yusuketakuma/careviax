import { defineConfig, devices } from '@playwright/test';
import { PLAYWRIGHT_OUTPUT_DIR } from './tools/tests/helpers/artifacts';

export default defineConfig({
  testDir: './tools/tests',
  testMatch: 'production-parity-smoke.spec.ts',
  outputDir: PLAYWRIGHT_OUTPUT_DIR,
  timeout: 120_000,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3012',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'pnpm db:e2e:prepare && pnpm start:e2e:production-parity',
    url: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3012',
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
