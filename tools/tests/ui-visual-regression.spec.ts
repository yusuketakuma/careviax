import { expect, test } from '@playwright/test';
import { attachLocalSession, openStableRoute } from './helpers/local-auth';

test.beforeEach(async ({ context }) => {
  await attachLocalSession(context);
});

test.describe('limited visual comparison', () => {
  test('dashboard process overview layout stays stable', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    await openStableRoute(page, '/dashboard');

    const processNow = page.getByTestId('dashboard-process-now');
    await expect(processNow).toBeVisible({ timeout: 20_000 });

    await expect(processNow).toHaveScreenshot('dashboard-process-now.png', {
      animations: 'disabled',
      caret: 'hide',
    });
  });

  test('patients board layout stays stable', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    await openStableRoute(page, '/patients');

    const board = page.getByTestId('patients-board');
    await expect(board).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('patients-board-grid')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('patient-board-card').first()).toBeVisible({ timeout: 30_000 });
    const generatedAtMeta = board.locator('p').filter({ hasText: /\d{1,2}:\d{2}/ });

    await expect(board).toHaveScreenshot('patients-board.png', {
      animations: 'disabled',
      caret: 'hide',
      mask: [generatedAtMeta],
    });
  });

  test('reports workspace layout stays stable', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    await openStableRoute(page, '/reports');

    const workspace = page.getByTestId('report-share-workspace');
    await expect(workspace).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('report-waiting-box')).toBeVisible({ timeout: 30_000 });

    await expect(workspace).toHaveScreenshot('report-share-workspace.png', {
      animations: 'disabled',
      caret: 'hide',
    });
  });

  test('reports waiting section layout stays stable', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    await openStableRoute(page, '/reports');

    const waitingBox = page.getByTestId('report-waiting-box');
    await expect(waitingBox).toBeVisible({ timeout: 20_000 });

    await expect(waitingBox).toHaveScreenshot('report-waiting-box.png', {
      animations: 'disabled',
      caret: 'hide',
    });
  });
});
