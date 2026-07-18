import { expect, test, type Page } from '@playwright/test';
import { attachLocalSession, createInstrumentedPage, openStableRoute } from './helpers/local-auth';
import { apiPathPattern, fulfillJson } from './helpers/route-mocks';

const RAW_SITE_SERVER_DETAIL = 'route-mock-user-sites-token=secret';

const ROUTE_MOCK_USER = {
  id: 'route_mock_user',
  cognito_linked: true,
  name: 'RouteMock 担当者',
  name_kana: 'ルートモック タントウシャ',
  email: 'route-mock@example.test',
  phone: null,
  role: 'pharmacist',
  site_id: 'route_mock_site',
  site_name: 'RouteMock 店舗',
  is_active: true,
  account_status: 'active',
  invited_at: null,
  last_invited_at: null,
  activated_at: '2026-06-01T00:00:00.000Z',
  deactivated_at: null,
  deactivation_reason: null,
  last_active_at: '2026-06-17T00:00:00.000Z',
  max_daily_visits: 8,
  max_weekly_visits: 30,
  max_travel_minutes: 90,
  can_accept_emergency: true,
  visit_specialties: [],
  coverage_area: [],
  can_dispense: true,
  can_audit_dispense: true,
  can_set: false,
  can_audit_set: false,
  credential_types: [],
  monthly_visit_count: 0,
};

test.use({ serviceWorkers: 'block' });
test.setTimeout(120_000);

async function installDashboardShellRouteMocks(page: Page) {
  await page.route(apiPathPattern('/api/notifications/stream'), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: '',
    });
  });

  await page.route(apiPathPattern('/api/notifications'), async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('summary') === '1') {
      await fulfillJson(route, { data: { unreadCount: 0 } });
      return;
    }

    await fulfillJson(route, { data: [], hasMore: false, nextCursor: null });
  });

  await page.route(apiPathPattern('/api/nav-badges'), async (route) => {
    await fulfillJson(route, { data: { audit: 0, handoff: 0 } });
  });

  await page.route(apiPathPattern('/api/presence'), async (route) => {
    await fulfillJson(
      route,
      route.request().method() === 'POST' ? { data: { ok: true } } : { data: [] },
    );
  });
}

test.describe('admin users failed site-list route-mocked recovery', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('keeps a failed site query distinct from an empty selector and retries safely', async ({
    context,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'The desktop chromium flow covers the shared site-list failure contract once.',
    );

    const { page, errors } = await createInstrumentedPage(context, {
      captureHttpErrors: false,
    });
    await installDashboardShellRouteMocks(page);

    await page.route(apiPathPattern('/api/pharmacists'), async (route) => {
      await fulfillJson(route, {
        data: [ROUTE_MOCK_USER],
        meta: {
          total_count: 1,
          visible_count: 1,
          hidden_count: 0,
          truncated: false,
          count_basis: 'unique_users',
        },
      });
    });

    let siteRequestCount = 0;
    await page.route(apiPathPattern('/api/pharmacy-sites'), async (route) => {
      siteRequestCount += 1;
      await fulfillJson(route, { message: RAW_SITE_SERVER_DETAIL }, 500);
    });

    await openStableRoute(page, '/admin/users');
    await expect(page.getByRole('heading', { name: 'ユーザー管理' })).toBeVisible({
      timeout: 30_000,
    });
    await page.locator('summary').filter({ hasText: '詳細フィルタ' }).click();

    await expect(
      page.getByRole('heading', { name: '店舗一覧を取得できませんでした', level: 2 }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#user-filter-site')).toBeDisabled();
    await expect(
      page.getByText(/店舗の候補を確認できないため、空の一覧として扱わず/),
    ).toBeVisible();
    await expect(page.locator('body')).not.toContainText(RAW_SITE_SERVER_DETAIL);

    const requestsBeforeRetry = siteRequestCount;
    await page.getByRole('button', { name: '店舗一覧を再読み込み' }).first().click();
    await expect.poll(() => siteRequestCount).toBeGreaterThan(requestsBeforeRetry);

    await page.getByRole('button', { name: 'ユーザーを招待' }).click();
    await expect(page.locator('#invite-user-site')).toBeDisabled();
    await expect(page.getByRole('button', { name: '招待する' })).toBeDisabled();
    await page.getByRole('button', { name: 'キャンセル' }).click();

    await page.getByRole('button', { name: 'RouteMock 担当者の詳細を開く' }).click();
    await expect(page.locator('#detail-user-site')).toBeDisabled();
    await expect(
      page.getByText('店舗一覧を取得できないため、再読み込みしてから保存してください。'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: '変更を保存' })).toBeDisabled();

    expect(
      errors.filter(
        (error) =>
          error !==
          'console:Failed to load resource: the server responded with a status of 500 (Internal Server Error)',
      ),
    ).toEqual([]);
  });
});
