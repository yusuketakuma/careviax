import { expect, test } from '@playwright/test';
import { attachLocalSession, createInstrumentedPage, openStableRoute } from './helpers/local-auth';

const LAYOUT_ROUTES = [
  '/dashboard',
  '/patients',
  '/workflow',
  '/prescriptions',
  '/schedules',
  '/visits',
  '/reports',
  '/billing',
  '/communications/requests',
  '/notifications',
  '/external',
  '/settings',
  '/admin',
] as const;

test.describe('page scaffold layout', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  for (const route of LAYOUT_ROUTES) {
    test(`${route} keeps grouped layout without horizontal overflow`, async ({ context }) => {
      const { page, errors } = await createInstrumentedPage(context);
      await openStableRoute(page, route);

      const scaffold = page.getByTestId('page-scaffold');
      await expect(scaffold).toBeVisible();

      const appHeader = page.getByTestId('app-header');
      await expect(appHeader).toBeVisible();
      const appHeaderBox = await appHeader.boundingBox();
      expect(Math.round(appHeaderBox?.y ?? -1)).toBe(0);
      expect(Math.round(appHeaderBox?.height ?? 0)).toBe(56);

      const stack = page.getByTestId('page-scaffold-stack');
      const groupCount = await stack.locator(':scope > *').count();
      expect(groupCount).toBeGreaterThan(0);

      const metrics = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));

      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
      expect(errors).toEqual([]);
    });
  }
});
