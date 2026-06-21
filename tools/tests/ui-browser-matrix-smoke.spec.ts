import { expect, test } from '@playwright/test';
import { attachLocalSession, createInstrumentedPage, openStableRoute } from './helpers/local-auth';

const ROUTES = [
  { path: '/dashboard', readyTestId: 'dashboard-cockpit' },
  { path: '/patients', readyTestId: 'patients-board' },
  { path: '/reports', readyTestId: 'report-share-workspace' },
  { path: '/handoff', readyTestId: 'handoff-workspace' },
  { path: '/workflow', readyTestId: 'workflow-control-center' },
  { path: '/billing', readyTestId: 'billing-check' },
] as const;

test.beforeEach(async ({ context }) => {
  await attachLocalSession(context);
});

for (const route of ROUTES) {
  test(`${route.path} renders cleanly across browser matrix`, async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);

    await openStableRoute(page, route.path);

    await expect(page).toHaveURL(new RegExp(`${route.path.replace('/', '\\/')}(\\?.*)?$`));
    await expect(page.getByTestId(route.readyTestId)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('main')).toBeVisible();
    expect(errors).toEqual([]);
  });
}
