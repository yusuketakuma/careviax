import { expect, test, type Locator } from '@playwright/test';
import { attachLocalSession, openStableRoute } from './helpers/local-auth';

test.beforeEach(async ({ context }) => {
  await attachLocalSession(context);
});

async function waitForReportsDeliveryDashboardReady(deliveryDashboard: Locator) {
  await expect(deliveryDashboard.getByText(/集計中|集計しています/)).toHaveCount(0, {
    timeout: 60_000,
  });
}

test.describe('limited visual comparison', () => {
  test('dashboard workflow rail layout stays stable', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    await openStableRoute(page, '/dashboard');

    const rail = page.getByTestId('dashboard-phase-rail');
    await expect(rail).toBeVisible({ timeout: 20_000 });

    await expect(rail).toHaveScreenshot(
      'dashboard-phase-rail.png',
      {
        animations: 'disabled',
        caret: 'hide',
      }
    );
  });

  test('patients filter panel layout stays stable', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    await openStableRoute(page, '/patients');

    const filterPanel = page.getByTestId('patients-filter-panel');
    await expect(filterPanel).toBeVisible({ timeout: 20_000 });

    await expect(filterPanel).toHaveScreenshot(
      'patients-filter-panel.png',
      {
        animations: 'disabled',
        caret: 'hide',
      }
    );
  });

  test('reports handoff rail layout stays stable', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    await openStableRoute(page, '/reports');

    const deliveryDashboard = page.getByTestId('reports-delivery-dashboard');
    await expect(deliveryDashboard).toBeVisible({ timeout: 20_000 });
    await waitForReportsDeliveryDashboardReady(deliveryDashboard);

    await expect(deliveryDashboard).toHaveScreenshot(
      'reports-delivery-dashboard.png',
      {
        animations: 'disabled',
        caret: 'hide',
      }
    );
  });

  test('reports filter panel layout stays stable', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    await openStableRoute(page, '/reports');

    const filterPanel = page.getByTestId('reports-filter-panel');
    await expect(filterPanel).toBeVisible({ timeout: 20_000 });

    await expect(filterPanel).toHaveScreenshot(
      'reports-filter-panel.png',
      {
        animations: 'disabled',
        caret: 'hide',
      }
    );
  });
});
