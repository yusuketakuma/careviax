import { defineConfig, devices } from '@playwright/test';
import { PLAYWRIGHT_OUTPUT_DIR } from './tools/tests/helpers/artifacts';

export default defineConfig({
  testDir: './tools/tests',
  outputDir: PLAYWRIGHT_OUTPUT_DIR,
  timeout: 240_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3012',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 5'] },
    },
  ],
});
