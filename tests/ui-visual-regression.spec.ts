import { expect, test } from '@playwright/test';
import { attachLocalSession, waitForStableUi } from './helpers/local-auth';

test.beforeEach(async ({ context }) => {
  await attachLocalSession(context);
});

test.describe('limited visual comparison', () => {
  test('dashboard workflow rail layout stays stable', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    await page.goto('/dashboard');
    await waitForStableUi(page);

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

    await page.goto('/patients');
    await waitForStableUi(page);

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

    await page.goto('/reports');
    await waitForStableUi(page);

    const phasePanel = page.getByTestId('workflow-phase-panel');
    await expect(phasePanel).toBeVisible({ timeout: 20_000 });

    await expect(phasePanel).toHaveScreenshot(
      'reports-workflow-phase-panel.png',
      {
        animations: 'disabled',
        caret: 'hide',
      }
    );
  });

  test('reports filter panel layout stays stable', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    await page.goto('/reports');
    await waitForStableUi(page);

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
