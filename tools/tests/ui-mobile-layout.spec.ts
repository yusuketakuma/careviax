import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { PLAYWRIGHT_SCREENSHOT_DIR } from './helpers/artifacts';
import { attachLocalSession, createInstrumentedPage, waitForStableUi } from './helpers/local-auth';

const MOBILE_ROUTES = [
  {
    name: 'dashboard-mobile-layout',
    path: '/dashboard',
    readyTestId: 'dashboard-priority-actions',
    primaryTarget: { role: 'heading' as const, name: '今日の運用' },
  },
  {
    name: 'patients-mobile-layout',
    path: '/patients',
    readyTestId: 'patients-filter-panel',
    primaryTarget: { role: 'heading' as const, name: '患者一覧' },
  },
  {
    name: 'reports-mobile-layout',
    path: '/reports',
    readyTestId: 'reports-filter-panel',
    primaryTarget: { role: 'heading' as const, name: '報告書' },
  },
  {
    name: 'workflow-mobile-layout',
    path: '/workflow',
    readyTestId: 'workflow-control-center',
    primaryTarget: { role: 'heading' as const, name: 'ワークフローダッシュボード' },
  },
  {
    name: 'billing-mobile-layout',
    path: '/billing',
    readyTestId: 'billing-action-strip',
    primaryTarget: { role: 'heading' as const, name: '請求支援ダッシュボード' },
  },
] as const;

async function writeMobileScreenshot(page: Page, name: string) {
  await fs.mkdir(PLAYWRIGHT_SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(PLAYWRIGHT_SCREENSHOT_DIR, `${name}.png`),
    fullPage: true,
  });
}

test.describe('mobile layout flow', () => {
  test.use({ viewport: { width: 393, height: 851 } });

  test.beforeEach(async ({ context }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium');
    await attachLocalSession(context);
  });

  for (const route of MOBILE_ROUTES) {
    test(`${route.path} keeps mobile-first grouping and CTA visibility`, async ({ context }) => {
      const { page, errors } = await createInstrumentedPage(context);
      await page.goto(route.path);
      await waitForStableUi(page);

      await expect(page.getByTestId(route.readyTestId)).toBeVisible();
      await expect(
        page.getByRole(route.primaryTarget.role, { name: route.primaryTarget.name }),
      ).toBeVisible();

      const metrics = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));

      const shortcutRows = page.locator('[data-testid="page-scaffold-stack"] > *').first();
      await expect(shortcutRows).toBeVisible();

      await writeMobileScreenshot(page, route.name);
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
      expect(errors).toEqual([]);
    });
  }
});
