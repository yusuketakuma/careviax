import { expect, test } from '@playwright/test';
import { attachLocalSession, createInstrumentedPage, openStableRoute } from './helpers/local-auth';

const ROUTES = [
  { path: '/dashboard', readyTestId: 'dashboard-priority-actions' },
  { path: '/patients', readyTestId: 'patients-filter-panel' },
  { path: '/reports', readyTestId: 'reports-filter-panel' },
  { path: '/workflow', readyTestId: 'workflow-control-center' },
  { path: '/billing', readyTestId: 'billing-action-strip' },
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
