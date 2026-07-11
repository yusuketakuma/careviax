import { expect, test, type Page } from '@playwright/test';
import { attachLocalSession, createInstrumentedPage, openStableRoute } from './helpers/local-auth';
import { apiPathPattern, fulfillJson } from './helpers/route-mocks';

const PATIENT_ID = 'patient_edit_error_route_mock';
const RAW_SERVER_DETAIL = 'route-mock-patient-identity-token=secret';

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

test.describe('patient edit failed overview route-mocked recovery', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('keeps a failed overview distinct from not-found, redacts server detail, and retries', async ({
    context,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Patient edit failure-state browser proof runs once in chromium.',
    );

    const { page, errors } = await createInstrumentedPage(context, {
      captureHttpErrors: false,
    });
    await installDashboardShellRouteMocks(page);

    let overviewRequestCount = 0;
    await page.route(apiPathPattern(`/api/patients/${PATIENT_ID}/overview`), async (route) => {
      overviewRequestCount += 1;
      await fulfillJson(route, { message: RAW_SERVER_DETAIL }, 500);
    });

    await openStableRoute(page, `/patients/${PATIENT_ID}/edit`);

    await expect(
      page.getByRole('heading', { name: '患者情報を表示できません', level: 2 }),
    ).toBeVisible();
    await expect(page.getByText('患者情報が見つかりません')).toHaveCount(0);
    await expect(
      page.getByText(/患者情報の取得に失敗しました。\s*通信状態を確認して再試行してください。/),
    ).toBeVisible();
    await expect(page.locator('body')).not.toContainText(RAW_SERVER_DETAIL);

    const requestsBeforeRetry = overviewRequestCount;
    await page.getByRole('button', { name: '再試行' }).click();
    await expect.poll(() => overviewRequestCount).toBeGreaterThan(requestsBeforeRetry);

    expect(
      errors.filter(
        (error) =>
          error !==
          'console:Failed to load resource: the server responded with a status of 500 (Internal Server Error)',
      ),
    ).toEqual([]);
  });
});
