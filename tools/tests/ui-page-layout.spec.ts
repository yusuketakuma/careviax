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

const SHARED_CARD_ROUTES = new Set<string>([
  '/workflow',
  '/communications/requests',
  '/notifications',
  '/external',
]);

const SHARED_PAGE_HEADER_ROUTES = new Set<string>([
  '/workflow',
  '/communications/requests',
  '/external',
]);

const FLUSH_BOTTOM_ROUTES = new Set<string>(['/prescriptions']);

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
      const scaffoldPadding = await scaffold.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          top: Number.parseFloat(style.paddingTop),
          right: Number.parseFloat(style.paddingRight),
          bottom: Number.parseFloat(style.paddingBottom),
          left: Number.parseFloat(style.paddingLeft),
        };
      });
      const expectedCanvasPadding = (page.viewportSize()?.width ?? 0) >= 1024 ? 24 : 16;
      expect(scaffoldPadding).toEqual({
        top: expectedCanvasPadding,
        right: expectedCanvasPadding,
        bottom: FLUSH_BOTTOM_ROUTES.has(route) ? 0 : expectedCanvasPadding,
        left: expectedCanvasPadding,
      });

      const appHeader = page.getByTestId('app-header');
      await expect(appHeader).toBeVisible();
      const appHeaderBox = await appHeader.boundingBox();
      expect(Math.round(appHeaderBox?.y ?? -1)).toBe(0);
      expect(Math.round(appHeaderBox?.height ?? 0)).toBe(56);

      const stack = page.getByTestId('page-scaffold-stack');
      const groupCount = await stack.locator(':scope > *').count();
      expect(groupCount).toBeGreaterThan(0);

      if (SHARED_CARD_ROUTES.has(route)) {
        const firstGroup = stack.locator(':scope > *').first();
        const surface = await firstGroup.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            backgroundImage: style.backgroundImage,
            borderRadius: Number.parseFloat(style.borderTopLeftRadius),
            borderTopWidth: Number.parseFloat(style.borderTopWidth),
            boxShadow: style.boxShadow,
            overflow: style.overflow,
          };
        });

        expect(surface.backgroundImage).toBe('none');
        expect(surface.borderRadius).toBeGreaterThan(0);
        expect(surface.borderRadius).toBeLessThanOrEqual(6);
        expect(surface.borderTopWidth).toBe(1);
        expect(surface.boxShadow).toBe('none');
        expect(surface.overflow).toBe('visible');
      }

      if (SHARED_PAGE_HEADER_ROUTES.has(route)) {
        await expect(page.locator('[data-page-header="true"]')).toHaveCount(1);
        await expect(page.locator('[data-page-header-frame="true"]')).toHaveCount(1);
      }

      const metrics = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));

      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
      expect(errors).toEqual([]);
    });
  }
});
