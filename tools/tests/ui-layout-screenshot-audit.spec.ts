import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { attachLocalSession, createInstrumentedPage, openStableRoute } from './helpers/local-auth';

const SCREENSHOT_DIR = path.join('test-results', 'ui-layout-screenshot-audit');

const screens = [
  { name: 'dashboard', path: '/dashboard', heading: 'ダッシュボード' },
  { name: 'my-day', path: '/my-day', heading: 'My Day' },
  { name: 'patients', path: '/patients', heading: '患者一覧' },
  { name: 'schedules', path: '/schedules', heading: 'スケジュール' },
  { name: 'dispensing', path: '/dispense', heading: '調剤' },
] as const;

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

test.describe('UI layout screenshot audit', () => {
  test.beforeEach(async ({ context }) => {
    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
    await attachLocalSession(context);
  });

  for (const viewport of viewports) {
    for (const screen of screens) {
      test(`${screen.name} ${viewport.name} screenshot`, async ({ context }) => {
        const { page, errors } = await createInstrumentedPage(context, {
          captureHttpErrors: false,
        });
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await openStableRoute(page, screen.path);

        await expect(page.getByRole('heading', { name: screen.heading }).first()).toBeVisible({
          timeout: 60_000,
        });
        await expect(page.locator('main')).toBeVisible();

        const overflow = await page.evaluate(() => ({
          bodyScrollWidth: document.body.scrollWidth,
          documentScrollWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
        }));
        expect(overflow.documentScrollWidth).toBeLessThanOrEqual(overflow.viewportWidth + 2);
        expect(overflow.bodyScrollWidth).toBeLessThanOrEqual(overflow.viewportWidth + 2);

        await page.screenshot({
          path: path.join(SCREENSHOT_DIR, `${screen.name}-${viewport.name}.png`),
          fullPage: true,
          caret: 'initial',
          animations: 'disabled',
        });

        expect(errors).toEqual([]);
      });
    }
  }
});
