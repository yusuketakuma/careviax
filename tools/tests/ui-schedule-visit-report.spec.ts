import { expect, test } from '@playwright/test';
import {
  attachLocalSession,
  createInstrumentedPage,
  waitForStableUi,
} from './helpers/local-auth';

test.describe('schedule page', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('schedule page loads with day view and week navigation', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/schedules');
    await waitForStableUi(page);

    await expect(page.getByRole('heading', { name: '訪問スケジュール' })).toBeVisible();

    // Week navigation buttons should be present
    await expect(page.getByRole('button', { name: '前週' })).toBeVisible();
    await expect(page.getByRole('button', { name: '翌週' })).toBeVisible();

    // Filter known React Query warning for visit-route-plan (tracked as BUG-002)
    const realErrors = errors.filter((e) => !e.includes('Query data cannot be undefined'));
    expect(realErrors).toEqual([]);
  });

  test('week navigation changes displayed dates without errors', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/schedules');
    await waitForStableUi(page);

    // Click next week
    await page.getByRole('button', { name: '翌週' }).click();
    await waitForStableUi(page);

    // Click previous week twice to go back one week before current
    await page.getByRole('button', { name: '前週' }).click();
    await waitForStableUi(page);
    await page.getByRole('button', { name: '前週' }).click();
    await waitForStableUi(page);

    // Page should still be intact, no errors
    await expect(page.getByRole('heading', { name: '訪問スケジュール' })).toBeVisible();

    // Filter known React Query warning for visit-route-plan (tracked as BUG-002)
    const realErrors = errors.filter((e) => !e.includes('Query data cannot be undefined'));
    expect(realErrors).toEqual([]);
  });

  test('schedule view toggle switches between list and calendar', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/schedules');
    await waitForStableUi(page);

    // Look for a view toggle (list/calendar)
    const calendarToggle = page.getByRole('button', { name: /カレンダー/ });
    const listToggle = page.getByRole('button', { name: /リスト|一覧/ });

    if (await calendarToggle.isVisible().catch(() => false)) {
      await calendarToggle.click();
      await waitForStableUi(page);

      // Calendar view should have month navigation
      await expect(page.getByRole('button', { name: '前月' }).or(page.getByRole('button', { name: '翌月' }))).toBeVisible();

      // Switch back to list
      if (await listToggle.isVisible().catch(() => false)) {
        await listToggle.click();
        await waitForStableUi(page);
      }
    }

    // Filter known issues: React Query undefined warning (BUG-002) and rate limiting
    const realErrors = errors.filter(
      (e) => !e.includes('Query data cannot be undefined') && !e.includes('http:429'),
    );
    expect(realErrors).toEqual([]);
  });

  test('schedule proposals page loads and shows proposals or empty state', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/schedules/proposals');
    await waitForStableUi(page);

    const main = page.locator('main');
    const content = await main.textContent();
    expect(content?.trim().length).toBeGreaterThan(0);

    // Back link should be present (scoped to main to avoid sidebar)
    await expect(main.getByRole('link', { name: /スケジュールへ戻る|スケジュール一覧/ })).toBeVisible();

    expect(errors).toEqual([]);
  });
});

test.describe('visits page', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('visits list page loads with table and date filters', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/visits');
    await waitForStableUi(page);

    await expect(page.getByRole('heading', { name: '訪問記録一覧' })).toBeVisible();

    // Date range filter inputs should exist
    const dateFrom = page.locator('#date-from');
    const dateTo = page.locator('#date-to');
    await expect(dateFrom).toBeVisible();
    await expect(dateTo).toBeVisible();

    // Shortcut links
    const main = page.locator('main');
    await expect(main.getByRole('link', { name: 'スケジュール' })).toBeVisible();
    await expect(main.getByRole('link', { name: '報告' })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('visits table shows data or empty state', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/visits');
    await waitForStableUi(page);

    // Should show either table rows or empty message
    const hasRows = await page.locator('table tbody tr').count() > 0;
    const hasEmpty = await page.getByText('訪問記録がありません').isVisible().catch(() => false);

    expect(hasRows || hasEmpty).toBe(true);

    expect(errors).toEqual([]);
  });

  test('visit detail page loads from visits list', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/visits');
    await waitForStableUi(page);

    // If there are visit records, click the first one
    const firstVisitLink = page.locator('table tbody tr').first().locator('a[href^="/visits/"]').first();
    if (await firstVisitLink.isVisible().catch(() => false)) {
      const href = await firstVisitLink.getAttribute('href');
      await firstVisitLink.click();
      await expect(page).toHaveURL(new RegExp(`${href}$`));
      await waitForStableUi(page);

      // Visit detail should show SOAP sections
      const main = page.locator('main');
      const hasSOAP = await main.getByText(/主観情報|客観情報|薬学的評価|計画・介入/).first().isVisible().catch(() => false);
      const hasContent = (await main.textContent())?.trim().length ?? 0;
      expect(hasSOAP || hasContent > 0).toBe(true);
    }

    expect(errors).toEqual([]);
  });

  test('date filter on visits page is functional', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/visits');
    await waitForStableUi(page);

    // Date filter inputs should be functional
    const dateFrom = page.locator('#date-from');
    const dateTo = page.locator('#date-to');
    await expect(dateFrom).toBeEnabled();
    await expect(dateTo).toBeEnabled();

    // Fill dates and verify the inputs accept values
    await dateFrom.fill('2026-01-01');
    await dateTo.fill('2026-12-31');
    const fromValue = await dateFrom.inputValue();
    const toValue = await dateTo.inputValue();
    expect(fromValue).toBe('2026-01-01');
    expect(toValue).toBe('2026-12-31');

    expect(errors).toEqual([]);
  });
});

test.describe('reports page', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('reports page loads with filter panel and table', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/reports');
    await waitForStableUi(page);

    await expect(page.getByRole('heading', { name: '報告書' })).toBeVisible();

    // Filter panel should be visible
    const filterPanel = page.getByTestId('reports-filter-panel');
    await expect(filterPanel).toBeVisible();

    // Search placeholder
    await expect(page.getByPlaceholder('患者名 / フリガナ')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('reports table shows data or empty state', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/reports');
    await waitForStableUi(page);

    const hasRows = await page.locator('table tbody tr').count() > 0;
    const hasEmpty = await page.getByText('報告書がありません').isVisible().catch(() => false);

    expect(hasRows || hasEmpty).toBe(true);

    expect(errors).toEqual([]);
  });

  test('report detail page loads from reports list', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/reports');
    await waitForStableUi(page);

    // If there are reports, click the first detail link
    const firstRow = page.locator('table tbody tr').first();
    const detailLink = firstRow.locator('a').first();
    if (await detailLink.isVisible().catch(() => false)) {
      const href = await detailLink.getAttribute('href');
      if (href?.startsWith('/reports/')) {
        await detailLink.click();
        await expect(page).toHaveURL(new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        await waitForStableUi(page);

        // Report detail should show content
        const main = page.locator('main');
        const content = await main.textContent();
        expect(content?.trim().length).toBeGreaterThan(0);
      }
    }

    expect(errors).toEqual([]);
  });

  test('reports filter panel search narrows results', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/reports');
    await waitForStableUi(page);

    const searchInput = page.getByPlaceholder('患者名 / フリガナ');
    await searchInput.fill('ZZZNONEXISTENT');
    await page.waitForTimeout(1000);
    await waitForStableUi(page);

    // Should show empty or fewer results
    const hasEmpty = await page.getByText('報告書がありません').isVisible().catch(() => false);
    const rows = await page.locator('table tbody tr').count();
    expect(hasEmpty || rows === 0).toBe(true);

    expect(errors).toEqual([]);
  });
});

test.describe('admin dashboard', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('admin dashboard loads with summary cards', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/admin');
    await waitForStableUi(page);

    await expect(page.getByRole('heading', { name: '管理者ダッシュボード' })).toBeVisible();

    // Should have summary metrics or global empty state
    const mainContent = page.locator('main');
    const hasMetrics = await mainContent.getByText(/未記録訪問|未送付報告|月間|例外/).first().isVisible().catch(() => false);
    const hasEmptyAll = await mainContent.getByText('現時点で重大な滞留はありません').isVisible().catch(() => false);
    const contentLength = (await mainContent.textContent())?.trim().length ?? 0;

    expect(hasMetrics || hasEmptyAll || contentLength > 100).toBe(true);

    expect(errors).toEqual([]);
  });

  test('admin monthly navigation works without errors', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/admin');
    await waitForStableUi(page);

    // Monthly navigation buttons
    const prevMonth = page.getByRole('button', { name: '前月' });
    const nextMonth = page.getByRole('button', { name: '翌月' });

    if (await prevMonth.isVisible().catch(() => false)) {
      await prevMonth.click();
      await waitForStableUi(page);

      await nextMonth.click();
      await waitForStableUi(page);

      // Page should still be functional
      const main = page.locator('main');
      const content = await main.textContent();
      expect(content?.trim().length).toBeGreaterThan(0);
    }

    expect(errors).toEqual([]);
  });
});
