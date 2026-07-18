import { defineConfig, devices } from '@playwright/test';
import baseConfig from './playwright.local.config';
import {
  PLAYWRIGHT_AUDIT_JSON_REPORT,
  PLAYWRIGHT_AUDIT_OUTPUT_DIR,
  PLAYWRIGHT_AUDIT_REPORT_DIR,
} from './tools/tests/helpers/artifacts';

export default defineConfig({
  ...baseConfig,
  forbidOnly: true,
  testIgnore: ['production-parity-smoke.spec.ts', 'ui-comment-thread-network-smoke.spec.ts'],
  outputDir: PLAYWRIGHT_AUDIT_OUTPUT_DIR,
  reporter: [
    ['list'],
    ['html', { outputFolder: PLAYWRIGHT_AUDIT_REPORT_DIR, open: 'never' }],
    ['json', { outputFile: PLAYWRIGHT_AUDIT_JSON_REPORT }],
  ],
  use: {
    ...baseConfig.use,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command:
      'SEED_DEMO_BULK_PATIENTS=100 E2E_FORCE_RESET=1 pnpm db:e2e:prepare && pnpm build:e2e:local && pnpm start:e2e:local',
    url: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3012',
    reuseExistingServer: false,
    timeout: 1_200_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox-audit',
      testMatch: /ui-browser-matrix-smoke\.spec\.ts/,
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit-audit',
      testMatch: /ui-browser-matrix-smoke\.spec\.ts/,
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'mobile-chromium',
      testMatch:
        /(e2e-prescription-dispensing-flow|ui-audit-extensions|ui-mobile-layout|ui-route-mocked-smoke)\.spec\.ts/,
      use: {
        ...devices['Pixel 7'],
      },
    },
  ],
});
