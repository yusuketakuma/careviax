import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { attachLocalSession, openStableRoute } from './helpers/local-auth';
import { STABLE_PATIENT_BOARD_RESPONSE } from './helpers/patient-board-fixture';

test.describe('patient board selected preview', () => {
  test('uses one card DTO for desktop preview and the mobile sheet', async ({ context }) => {
    await attachLocalSession(context);
    const page = await context.newPage();
    await page.route('**/api/patients/board?**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(STABLE_PATIENT_BOARD_RESPONSE),
      });
    });

    await page.setViewportSize({ width: 1280, height: 900 });
    await openStableRoute(page, '/patients');
    await expect(page.getByTestId('patients-board-grid')).toBeVisible();
    await expect(page.getByTestId('patient-board-preview-placeholder')).toBeVisible();
    const cardLinks = page.getByTestId('patient-board-card-link');
    await expect(cardLinks.nth(0)).toHaveAttribute('href', '/patients/preview_patient_a');
    await expect(cardLinks.nth(1)).toHaveAttribute('href', '/patients/preview_patient_b');

    await page.getByRole('button', { name: 'テスト患者Aを右プレビュー' }).click();
    const desktopPreview = page.getByTestId('patient-board-selected-preview');
    await expect(desktopPreview).toBeVisible();
    await expect(desktopPreview.getByRole('heading', { name: 'テスト患者A' })).toBeVisible();
    await expect(desktopPreview).toContainText('監査前の確認が必要です');
    await expect(desktopPreview.getByRole('link', { name: '患者詳細' })).toHaveAttribute(
      'href',
      '/patients/preview_patient_a',
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'テスト患者Bをプレビュー' }).click();
    const sheet = page.getByRole('dialog', { name: '患者プレビュー' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('heading', { name: 'テスト患者B' })).toBeVisible();
    await expect(sheet).toContainText('外部からの回答を待っています');
    await expect(sheet.getByRole('link', { name: '患者詳細' })).toHaveAttribute(
      'href',
      '/patients/preview_patient_b',
    );

    const closeButton = sheet.getByRole('button', { name: '患者プレビューを閉じる' });
    const closeBox = await closeButton.boundingBox();
    expect(closeBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(closeBox?.height ?? 0).toBeGreaterThanOrEqual(44);

    const viewportMetrics = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(viewportMetrics.scrollWidth).toBeLessThanOrEqual(viewportMetrics.clientWidth + 1);
  });

  test('keeps the populated patient board accessible in forced colors and a 200%-equivalent viewport', async ({
    context,
  }) => {
    await attachLocalSession(context);
    const page = await context.newPage();
    await page.route('**/api/patients/board?**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(STABLE_PATIENT_BOARD_RESPONSE),
      });
    });

    await page.setViewportSize({ width: 768, height: 512 });
    await openStableRoute(page, '/patients');
    await expect(page.getByTestId('patients-board-grid')).toBeVisible();

    const axeResults = await new AxeBuilder({ page }).include('main').analyze();
    const severeViolations = axeResults.violations.filter((violation) =>
      ['critical', 'serious'].includes(violation.impact ?? ''),
    );
    expect(
      severeViolations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        targets: violation.nodes.flatMap((node) => node.target.map(String)),
      })),
    ).toEqual([]);

    await page.emulateMedia({ forcedColors: 'active' });
    await expect
      .poll(() => page.evaluate(() => window.matchMedia('(forced-colors: active)').matches))
      .toBe(true);

    const previewButton = page.getByRole('button', { name: 'テスト患者Aをプレビュー' });
    let reachedPreviewButton = false;
    await page.locator('body').press('Home');
    for (let step = 0; step < 80; step += 1) {
      await page.keyboard.press('Tab');
      if (await previewButton.evaluate((element) => element === document.activeElement)) {
        reachedPreviewButton = true;
        break;
      }
    }

    const previewButtonBox = await previewButton.boundingBox();
    const overflowWidth = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

    expect(reachedPreviewButton).toBe(true);
    expect(previewButtonBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(overflowWidth).toBeLessThanOrEqual(1);
  });
});
