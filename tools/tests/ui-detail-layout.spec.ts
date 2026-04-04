import { expect, test, type Page } from '@playwright/test';
import { attachLocalSession, createInstrumentedPage, waitForStableUi } from './helpers/local-auth';

async function openFirstPatientDetail(page: Page) {
  await page.goto('/patients');
  await waitForStableUi(page);
  const firstLink = page
    .locator('a[href^="/patients/"]:not([href="/patients/new"])')
    .filter({ visible: true })
    .first();
  await expect(firstLink).toBeVisible();
  const href = await firstLink.getAttribute('href');
  expect(href).toBeTruthy();
  await page.goto(href!);
  await waitForStableUi(page);
}

async function openFirstVisitDetail(page: Page) {
  await page.goto('/visits');
  await waitForStableUi(page);
  const firstLink = page.locator('a[href^="/visits/"]').filter({ visible: true }).first();
  await expect(firstLink).toBeVisible();
  const href = await firstLink.getAttribute('href');
  expect(href).toBeTruthy();
  await page.goto(href!);
  await waitForStableUi(page);
}

test.describe('detail page layout', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('patient detail keeps grouped layout and visible tab navigation', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openFirstPatientDetail(page);

    await expect(page.getByTestId('page-scaffold')).toBeVisible();
    await expect(page.getByTestId('patient-detail-tablist')).toBeVisible();

    const metrics = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));

    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
    expect(errors).toEqual([]);
  });

  test('visit detail keeps grouped layout and action cluster visible', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openFirstVisitDetail(page);

    await expect(page.getByTestId('page-scaffold')).toBeVisible();
    await expect(page.getByRole('link', { name: '訪問記録 PDF を開く' })).toBeVisible();
    await expect(page.getByRole('button', { name: /報告書生成|生成中/ })).toBeVisible();

    const metrics = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));

    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
    expect(errors).toEqual([]);
  });
});
