import { expect, test } from '@playwright/test';
import {
  attachLocalSession,
  createInstrumentedPage,
  waitForStableUi,
} from './helpers/local-auth';

test.describe('dashboard page', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('dashboard loads with header and main content sections', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/dashboard');
    await waitForStableUi(page);

    // Dashboard header
    await expect(page.getByRole('heading', { name: 'CareViaX — ダッシュボード', level: 1 })).toBeVisible();

    // Main content area should have meaningful content
    const main = page.locator('main');
    const content = await main.textContent();
    expect(content?.trim().length).toBeGreaterThan(0);

    expect(errors).toEqual([]);
  });

  test('dashboard renders actionable content in the main region', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/dashboard');
    await waitForStableUi(page);

    const main = page.locator('main');
    const interactiveCount = await main.locator('a, button').count();
    expect(interactiveCount).toBeGreaterThan(0);

    expect(errors).toEqual([]);
  });
});

test.describe('sidebar navigation', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('sidebar shows all main workflow navigation items', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/dashboard');
    await waitForStableUi(page);

    const sidebar = page.getByTestId('app-sidebar');

    // Main workflow items
    await expect(sidebar.getByRole('link', { name: 'ホーム' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: '患者' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: '処方受付' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'スケジュール' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: '調剤' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: '鑑査' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: '訪問' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: '報告' })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('sidebar shows workbench navigation items', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/dashboard');
    await waitForStableUi(page);

    const sidebar = page.getByTestId('app-sidebar');

    // Workbench section label
    await expect(sidebar.getByText('ワークベンチ')).toBeVisible();

    // Workbench items
    await expect(sidebar.getByRole('link', { name: 'My Day' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'ワークフロー' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: '請求' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: '通知' })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('clicking sidebar patients link navigates to patients page', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/dashboard');
    await waitForStableUi(page);

    await Promise.all([
      page.waitForURL(/\/patients$/, { timeout: 10_000 }),
      page.getByTestId('sidebar-nav-patients').click(),
    ]);

    await expect(page.getByRole('heading', { name: '患者一覧', level: 1 })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('sidebar highlights active route correctly', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);

    // Navigate to patients page
    await page.goto('/patients');
    await waitForStableUi(page);

    // The patients link in sidebar should have active styling
    const patientsLink = page.getByTestId('sidebar-nav-patients');
    await expect(patientsLink).toBeVisible();

    // Check it has the active class or aria-current
    const className = await patientsLink.getAttribute('class');
    const ariaCurrent = await patientsLink.getAttribute('aria-current');

    // Should have either active styling class or aria-current="page"
    const isActive = className?.includes('bg-') || ariaCurrent === 'page';
    expect(isActive).toBe(true);

    expect(errors).toEqual([]);
  });

  test('settings link at bottom of sidebar navigates to settings', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/dashboard');
    await waitForStableUi(page);

    const sidebar = page.getByTestId('app-sidebar');
    const settingsLink = sidebar.getByRole('link', { name: '設定' });
    await expect(settingsLink).toBeVisible();

    await Promise.all([
      page.waitForURL(/\/settings$/, { timeout: 10_000 }),
      settingsLink.click(),
    ]);

    expect(errors).toEqual([]);
  });

  test('logout button is visible in sidebar', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/dashboard');
    await waitForStableUi(page);

    const sidebar = page.getByTestId('app-sidebar');
    await expect(sidebar.getByRole('button', { name: 'ログアウト' })).toBeVisible();

    expect(errors).toEqual([]);
  });
});

test.describe('breadcrumb navigation', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('patient detail page shows breadcrumb with home and patients links', async ({
    context,
  }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/patients');
    await waitForStableUi(page);

    // Navigate to patient detail
    const firstPatientLink = page.locator('tbody tr').first().locator('a[href^="/patients/"]').first();
    await firstPatientLink.click();
    await waitForStableUi(page);

    // Breadcrumb should be visible
    const breadcrumb = page.getByRole('navigation', { name: 'パンくずリスト' });
    await expect(breadcrumb).toBeVisible();

    // Home link in breadcrumb
    await expect(breadcrumb.getByRole('link', { name: 'ホームへ' })).toBeVisible();

    // Patients link in breadcrumb
    await expect(breadcrumb.getByRole('link', { name: '患者' })).toBeVisible();

    // Current page indicated
    await expect(breadcrumb.getByText('患者詳細')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('breadcrumb home link navigates to dashboard', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/patients');
    await waitForStableUi(page);

    const breadcrumb = page.getByRole('navigation', { name: 'パンくずリスト' });
    await Promise.all([
      page.waitForURL(/\/dashboard$/, { timeout: 10_000 }),
      breadcrumb.getByRole('link', { name: 'ホームへ' }).click(),
    ]);

    await expect(page.getByRole('heading', { name: 'CareViaX — ダッシュボード', level: 1 })).toBeVisible();
    expect(errors).toEqual([]);
  });
});
