import { defineConfig, devices } from '@playwright/test';
import baseConfig from './playwright.local.config';

export default defineConfig({
  ...baseConfig,
  outputDir: 'artifacts/playwright-audit/output',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'artifacts/playwright-audit/reports/html', open: 'never' }],
    ['json', { outputFile: 'artifacts/playwright-audit/reports/json/report.json' }],
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
