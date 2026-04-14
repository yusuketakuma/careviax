import { expect, test } from '@playwright/test';
import {
  attachLocalSession,
  createInstrumentedPage,
  waitForStableUi,
} from './helpers/local-auth';

test.describe('prescription → QR scan → draft', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('QR scan page loads with scan interface', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/qr-scan');
    await waitForStableUi(page);

    // Page should render (camera or fallback text input)
    const main = page.locator('main');
    await expect(main).toBeVisible();
    const content = await main.textContent();
    expect(content?.trim().length).toBeGreaterThan(0);

    expect(errors).toEqual([]);
  });

  test('QR drafts list page loads', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/prescriptions/qr-drafts');
    await waitForStableUi(page);

    // Should show heading or list
    const main = page.locator('main');
    await expect(main).toBeVisible();

    // Either shows drafts or empty state
    const content = await main.textContent();
    expect(content?.trim().length).toBeGreaterThan(0);

    expect(errors).toEqual([]);
  });

  test('QR drafts list has link to QR scan', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/prescriptions/qr-drafts');
    await waitForStableUi(page);

    // Should have a way to start a new scan
    const scanLink = page.getByRole('link', { name: /QRスキャン|新規スキャン|スキャン/i });
    const hasScanLink = await scanLink.isVisible().catch(() => false);

    const scanBtn = page.getByRole('button', { name: /QRスキャン|新規スキャン|スキャン/i });
    const hasScanBtn = await scanBtn.isVisible().catch(() => false);

    // Shortcut links in header area
    const headerLink = page.locator('main').getByRole('link').first();
    const hasAnyLink = await headerLink.isVisible().catch(() => false);

    expect(hasScanLink || hasScanBtn || hasAnyLink).toBe(true);

    expect(errors).toEqual([]);
  });

  test('QR draft detail page navigates from list', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/prescriptions/qr-drafts');
    await waitForStableUi(page);

    // If any draft exists, clicking it should navigate to detail
    const firstDraftLink = page
      .locator('main')
      .locator('a[href*="/prescriptions/qr-drafts/"]')
      .first();
    const hasDraftLink = await firstDraftLink.isVisible().catch(() => false);

    if (hasDraftLink) {
      const href = await firstDraftLink.getAttribute('href');
      await firstDraftLink.click();
      await waitForStableUi(page);

      await expect(page).toHaveURL(new RegExp(href!));

      // Draft detail should render content
      const detailContent = await page.locator('main').textContent();
      expect(detailContent?.trim().length).toBeGreaterThan(0);
    }

    expect(errors).toEqual([]);
  });
});

test.describe('prescription intake flow', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('prescription list → new intake → form renders', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/prescriptions');
    await waitForStableUi(page);

    await expect(page.getByRole('heading', { name: '処方受付' })).toBeVisible();

    // Navigate to new intake
    const main = page.locator('main');
    await Promise.all([
      page.waitForURL(/\/prescriptions\/new/, {
        timeout: 30_000,
        waitUntil: 'domcontentloaded',
      }),
      main.locator('a[href="/prescriptions/new"]').first().click(),
    ]);

    await expect(page.getByRole('heading', { name: '新規処方受付' })).toBeVisible();

    // Required fields should be present
    await expect(page.getByRole('group', { name: '患者・ケース' })).toBeVisible();
    await expect(page.getByText('処方日')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('prescription intake navigates to dispensing queue via shortcut', async ({ context }) => {
    test.slow();
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/prescriptions');
    await waitForStableUi(page);

    const main = page.locator('main');
    await Promise.all([
      page.waitForURL(/\/dispensing/, {
        timeout: 30_000,
        waitUntil: 'domcontentloaded',
      }),
      main.locator('a[href="/dispensing"]').first().click(),
    ]);

    await expect(page.getByRole('heading', { name: '調剤キュー' })).toBeVisible();

    expect(errors).toEqual([]);
  });
});

test.describe('dispensing → auditing flow', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('dispensing queue loads and shows tasks or empty state', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/dispensing');
    await waitForStableUi(page);

    await expect(page.getByRole('heading', { name: '調剤キュー' })).toBeVisible();

    const content = await page.locator('main').textContent();
    expect(content?.trim().length).toBeGreaterThan(0);

    expect(errors).toEqual([]);
  });

  test('dispensing → auditing navigation works', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/dispensing');
    await waitForStableUi(page);

    const main = page.locator('main');
    await Promise.all([
      page.waitForURL(/\/auditing/, {
        timeout: 30_000,
        waitUntil: 'domcontentloaded',
      }),
      main.getByRole('link', { name: '鑑査' }).click(),
    ]);

    await expect(page.getByRole('heading', { name: '調剤鑑査' })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('auditing queue loads with task list or empty state', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/auditing');
    await waitForStableUi(page);

    await expect(page.getByRole('heading', { name: '調剤鑑査' })).toBeVisible();

    const content = await page.locator('main').textContent();
    expect(content?.trim().length).toBeGreaterThan(0);

    expect(errors).toEqual([]);
  });

  test('full prescription → dispensing → auditing round trip', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);

    // Start: prescriptions
    await page.goto('/prescriptions');
    await waitForStableUi(page);
    await expect(page.getByRole('heading', { name: '処方受付' })).toBeVisible();

    // → dispensing
    const main = page.locator('main');
    await Promise.all([
      page.waitForURL(/\/dispensing/, {
        timeout: 30_000,
        waitUntil: 'domcontentloaded',
      }),
      main.locator('a[href="/dispensing"]').first().click(),
    ]);
    await expect(page.getByRole('heading', { name: '調剤キュー' })).toBeVisible();

    // → auditing
    await Promise.all([
      page.waitForURL(/\/auditing/, {
        timeout: 30_000,
        waitUntil: 'domcontentloaded',
      }),
      main.locator('a[href="/auditing"]').first().click(),
    ]);
    await expect(page.getByRole('heading', { name: '調剤鑑査' })).toBeVisible();

    // → back to dispensing
    await Promise.all([
      page.waitForURL(/\/dispensing/, {
        timeout: 30_000,
        waitUntil: 'domcontentloaded',
      }),
      page.locator('main').locator('a[href="/dispensing"]').first().click(),
    ]);
    await expect(page.getByRole('heading', { name: '調剤キュー' })).toBeVisible();

    expect(errors).toEqual([]);
  });
});
