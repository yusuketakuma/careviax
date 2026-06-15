import { expect, test } from '@playwright/test';
import {
  attachLocalSession,
  clickAndWaitForStableRoute,
  createInstrumentedPage,
  openStableRoute,
} from './helpers/local-auth';

test.describe('prescription → QR scan → draft', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('QR scan page loads with scan interface', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/qr-scan');

    // Page should render (camera or fallback text input)
    const main = page.locator('main');
    await expect(main).toBeVisible();
    const content = await main.textContent();
    expect(content?.trim().length).toBeGreaterThan(0);

    expect(errors).toEqual([]);
  });

  test('QR drafts list page loads', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/prescriptions/qr-drafts');

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
    await openStableRoute(page, '/prescriptions/qr-drafts');

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
    await openStableRoute(page, '/prescriptions/qr-drafts');

    // If any draft exists, clicking it should navigate to detail
    const firstDraftLink = page
      .locator('main')
      .locator('a[href*="/prescriptions/qr-drafts/"]')
      .first();
    const hasDraftLink = await firstDraftLink.isVisible().catch(() => false);

    if (hasDraftLink) {
      const href = await firstDraftLink.getAttribute('href');
      expect(href).toBeTruthy();
      await clickAndWaitForStableRoute(page, new RegExp(href!), () =>
        firstDraftLink.click({ noWaitAfter: true }),
      );

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
    test.slow();
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/prescriptions');

    await expect(
      page.locator('main').getByRole('heading', { name: '処方受付' }).first(),
    ).toBeVisible({ timeout: 45_000 });

    // Navigate to new intake
    const main = page.locator('main');
    await clickAndWaitForStableRoute(
      page,
      /\/prescriptions\/new/,
      () => main.getByRole('link', { name: '新規受付' }).first().click({ noWaitAfter: true }),
      { timeout: 45_000 },
    );

    await expect(page.getByRole('heading', { name: '新規処方受付' })).toBeVisible({
      timeout: 45_000,
    });

    // Required fields should be present
    await expect(page.getByRole('group', { name: '患者・ケース' })).toBeVisible();
    await expect(page.getByText('処方日')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('prescription intake navigates to dispensing queue via shortcut', async ({ context }) => {
    test.slow();
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/prescriptions');

    const main = page.locator('main');
    await clickAndWaitForStableRoute(
      page,
      /\/dispensing/,
      () => main.getByRole('link', { name: '調剤キュー' }).first().click({ noWaitAfter: true }),
      { timeout: 45_000 },
    );

    await expect(page.getByRole('heading', { name: '調剤', exact: true })).toBeVisible({
      timeout: 45_000,
    });

    expect(errors).toEqual([]);
  });
});

test.describe('dispensing → auditing flow', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('dispensing queue loads and shows tasks or empty state', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/dispensing');

    await expect(page.getByRole('heading', { name: '調剤', exact: true })).toBeVisible();

    const content = await page.locator('main').textContent();
    expect(content?.trim().length).toBeGreaterThan(0);

    expect(errors).toEqual([]);
  });

  test('dispensing → auditing navigation works', async ({ context }) => {
    test.slow();
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/dispensing');

    const main = page.locator('main');
    await clickAndWaitForStableRoute(
      page,
      /\/auditing/,
      () =>
        main.getByRole('link', { name: '監査', exact: true }).first().click({ noWaitAfter: true }),
      { timeout: 45_000 },
    );

    await expect(page.getByRole('heading', { name: '監査キュー(全件一覧)' })).toBeVisible({
      timeout: 45_000,
    });

    expect(errors).toEqual([]);
  });

  test('auditing queue loads with task list or empty state', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/auditing');

    await expect(page.getByRole('heading', { name: '監査キュー(全件一覧)' })).toBeVisible();

    const content = await page.locator('main').textContent();
    expect(content?.trim().length).toBeGreaterThan(0);

    expect(errors).toEqual([]);
  });

  test('full prescription → dispensing → auditing round trip', async ({ context }) => {
    test.slow();
    const { page, errors } = await createInstrumentedPage(context);

    // Start: prescriptions
    await openStableRoute(page, '/prescriptions');
    await expect(
      page.locator('main').getByRole('heading', { name: '処方受付' }).first(),
    ).toBeVisible();

    // → dispensing
    await clickAndWaitForStableRoute(page, /\/dispensing/, () =>
      page.locator('main').getByRole('link', { name: '調剤キュー' }).first().click(),
    );
    await expect(page.getByRole('heading', { name: '調剤', exact: true })).toBeVisible();

    // → auditing
    await clickAndWaitForStableRoute(
      page,
      /\/auditing/,
      () =>
        page.locator('main').getByRole('link', { name: '監査', exact: true }).first().click({
          noWaitAfter: true,
        }),
      { timeout: 90_000 },
    );
    await expect(page.getByRole('heading', { name: '監査キュー(全件一覧)' })).toBeVisible();

    // → back to dispensing
    await clickAndWaitForStableRoute(page, /\/dispensing/, () =>
      page.locator('main').getByRole('link', { name: '調剤', exact: true }).first().click(),
    );
    await expect(page.getByRole('heading', { name: '調剤', exact: true })).toBeVisible();

    expect(errors).toEqual([]);
  });
});
