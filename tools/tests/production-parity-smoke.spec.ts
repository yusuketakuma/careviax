import { expect, test } from '@playwright/test';
import { attachLocalSession } from './helpers/local-auth';

const ORG_ID = 'cmnhseedorg0000amq9ph-os';
const CASE_ID = 'cmnhseedcase001amq9ph-os';
const LOCAL_DEMO_LOGIN_EMAIL = 'demo@ph-os.example.com';
const LOCAL_DEMO_LOGIN_PASSWORD = 'PhOsDemo-2026';

test('production standalone rejects the Playwright-only demo password path', async ({ page }) => {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('メールアドレス').fill(LOCAL_DEMO_LOGIN_EMAIL);
  await page.getByLabel('パスワード', { exact: true }).fill(LOCAL_DEMO_LOGIN_PASSWORD);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();

  await page.waitForURL(/\/(?:login|api\/auth\/error)(?:\?|$)/);
  const cookies = await page.context().cookies();
  expect(
    cookies.some((cookie) =>
      /^(?:__Secure-)?(?:next-auth|authjs)\.session-token$/.test(cookie.name),
    ),
  ).toBe(false);
});

test('production standalone keeps rate limiting fail-closed and omits demo hooks', async ({
  context,
  page,
}) => {
  await attachLocalSession(context);

  await page.goto('/offline-sync', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('main')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          typeof (
            window as typeof window & {
              __phosSeedOfflineSyncDemo?: unknown;
            }
          ).__phosSeedOfflineSyncDemo,
      ),
    )
    .toBe('undefined');

  const response = await context.request.get(
    `/api/management-plans?case_id=${encodeURIComponent(CASE_ID)}`,
    { headers: { 'x-org-id': ORG_ID } },
  );
  expect(response.status()).toBe(503);
  await expect(response.json()).resolves.toMatchObject({ code: 'RATE_LIMIT_UNAVAILABLE' });
  expect(response.headers()['retry-after']).toBeTruthy();
});
