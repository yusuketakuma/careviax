import { defineConfig, devices } from '@playwright/test';
import baseConfig from './playwright.local.config';
import {
  PLAYWRIGHT_AUDIT_JSON_REPORT,
  PLAYWRIGHT_AUDIT_OUTPUT_DIR,
  PLAYWRIGHT_AUDIT_REPORT_DIR,
} from './tools/tests/helpers/artifacts';

export default defineConfig({
  ...baseConfig,
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
      testMatch: /ui-audit-extensions\.spec\.ts/,
      use: {
        ...devices['Pixel 7'],
      },
    },
  ],
});
