import { chromium } from '@playwright/test';
import { createSessionToken } from '../tests/helpers/local-auth';

async function main() {
  const token = await createSessionToken();
  const baseUrl = process.env.APP_URL ?? 'http://localhost:3000';

  const context = await chromium.launchPersistentContext('/tmp/careviax-chrome-profile', {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1440, height: 960 },
  });

  await context.addCookies([
    {
      name: 'next-auth.session-token',
      value: token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => null);

  process.stdout.write(`Authenticated dashboard opened: ${baseUrl}/dashboard\n`);

  await new Promise(() => {
    // Keep the process alive so the Chrome window stays open.
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
