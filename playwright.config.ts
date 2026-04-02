import { defineConfig, devices } from '@playwright/test';
import {
  PLAYWRIGHT_OUTPUT_DIR,
  PLAYWRIGHT_REPORT_DIR,
} from './tools/tests/helpers/artifacts';

const LOCAL_PLAYWRIGHT_AUTH_SECRET = 'careviax-local-auth-secret';
const shouldReuseExistingServer = !process.env.CI && process.env.PLAYWRIGHT_REUSE_SERVER === '1';

export default defineConfig({
  testDir: './tools/tests',
  outputDir: PLAYWRIGHT_OUTPUT_DIR,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
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
    command: `PLAYWRIGHT=1 AUTH_SECRET=${LOCAL_PLAYWRIGHT_AUTH_SECRET} NEXTAUTH_SECRET=${LOCAL_PLAYWRIGHT_AUTH_SECRET} NEXTAUTH_URL=http://localhost:3000 NEXT_PUBLIC_DISABLE_NOTIFICATION_STREAM=1 pnpm build && PLAYWRIGHT=1 AUTH_SECRET=${LOCAL_PLAYWRIGHT_AUTH_SECRET} NEXTAUTH_SECRET=${LOCAL_PLAYWRIGHT_AUTH_SECRET} NEXTAUTH_URL=http://localhost:3000 NEXT_PUBLIC_DISABLE_NOTIFICATION_STREAM=1 pnpm start`,
    url: 'http://localhost:3000',
    reuseExistingServer: shouldReuseExistingServer,
  },
});
