import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import {
  PLAYWRIGHT_OUTPUT_DIR,
  PLAYWRIGHT_REPORT_DIR,
} from './tools/tests/helpers/artifacts';

const LOCAL_PLAYWRIGHT_AUTH_SECRET = 'careviax-local-auth-secret';
const shouldReuseExistingServer = !process.env.CI && process.env.PLAYWRIGHT_REUSE_SERVER === '1';
const NEXT_FONT_GOOGLE_MOCKED_RESPONSES = path.join(
  process.cwd(),
  'tools',
  'tests',
  'helpers',
  'next-font-google-mocked-responses.cjs'
);

export default defineConfig({
  testDir: './tools/tests',
  outputDir: PLAYWRIGHT_OUTPUT_DIR,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : 2,
  reporter: [['html', { outputFolder: PLAYWRIGHT_REPORT_DIR, open: 'never' }]],
  use: {
    baseURL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],
  webServer: {
    command: `PLAYWRIGHT=1 AUTH_SECRET=${LOCAL_PLAYWRIGHT_AUTH_SECRET} NEXTAUTH_SECRET=${LOCAL_PLAYWRIGHT_AUTH_SECRET} NEXTAUTH_URL=http://localhost:3000 NEXT_PUBLIC_DISABLE_NOTIFICATION_STREAM=1 NEXT_FONT_GOOGLE_MOCKED_RESPONSES=${NEXT_FONT_GOOGLE_MOCKED_RESPONSES} pnpm build && PLAYWRIGHT=1 AUTH_SECRET=${LOCAL_PLAYWRIGHT_AUTH_SECRET} NEXTAUTH_SECRET=${LOCAL_PLAYWRIGHT_AUTH_SECRET} NEXTAUTH_URL=http://localhost:3000 NEXT_PUBLIC_DISABLE_NOTIFICATION_STREAM=1 NEXT_FONT_GOOGLE_MOCKED_RESPONSES=${NEXT_FONT_GOOGLE_MOCKED_RESPONSES} pnpm start`,
    url: 'http://localhost:3000',
    reuseExistingServer: shouldReuseExistingServer,
  },
});
