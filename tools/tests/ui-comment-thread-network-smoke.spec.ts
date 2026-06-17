import { expect, test, type Page } from '@playwright/test';
import { attachLocalSession, createInstrumentedPage, openStableRoute } from './helpers/local-auth';
import { apiPathPattern, fulfillJson } from './helpers/route-mocks';

const COLLABORATION_PATIENT_ID = 'cmnhdemopt001amq9ph-os';
const STREAM_PATH = '/api/notifications/stream';
const COMMENTS_PATH = '/api/comments';

const REALTIME_WORKFLOW_DATA = {
  data: {
    route_control: {
      emergency_impact_items: 0,
      locked_schedules: 0,
      pending_override_requests: 0,
    },
    unified_workbench: [],
    workflow_exceptions: {
      open: 0,
    },
  },
};

test.use({ serviceWorkers: 'block' });
test.skip(
  process.env.PLAYWRIGHT_STREAM_SMOKE !== '1',
  'stream-enabled smoke requires PLAYWRIGHT_STREAM_SMOKE=1 and a server without NEXT_PUBLIC_DISABLE_NOTIFICATION_STREAM=1',
);

function isApiPath(url: string, pathname: string) {
  return new URL(url).pathname === pathname;
}

async function installCollaborationNetworkMocks(page: Page) {
  const commentGetRequests: URL[] = [];

  await page.route(apiPathPattern(COMMENTS_PATH), async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      commentGetRequests.push(new URL(request.url()));
      await fulfillJson(route, { data: [] });
      return;
    }

    await route.continue();
  });

  await page.route(apiPathPattern('/api/notifications'), (route) =>
    fulfillJson(route, { data: [], hasMore: false, nextCursor: null }),
  );
  await page.route(apiPathPattern('/api/nav-badges'), (route) =>
    fulfillJson(route, { data: { notifications: 0, handoff: 0, audits: 0 } }),
  );
  await page.route(apiPathPattern('/api/pharmacists'), (route) => fulfillJson(route, { data: [] }));

  return { commentGetRequests };
}

async function installNotificationsNetworkMocks(page: Page) {
  const inboxRequests: URL[] = [];

  await page.route(apiPathPattern('/api/notifications'), async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.searchParams.get('limit') === '50') {
      inboxRequests.push(requestUrl);
    }

    await fulfillJson(route, { data: [], hasMore: false, nextCursor: null });
  });
  await page.route(apiPathPattern('/api/nav-badges'), (route) =>
    fulfillJson(route, { data: { notifications: 0, handoff: 0, audits: 0 } }),
  );

  return { inboxRequests };
}

async function installAdminRealtimeNetworkMocks(page: Page) {
  const workflowRequests: URL[] = [];
  const unreadNotificationRequests: URL[] = [];

  await page.route(apiPathPattern('/api/dashboard/workflow'), async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.searchParams.get('view') === 'realtime') {
      workflowRequests.push(requestUrl);
    }

    await fulfillJson(route, REALTIME_WORKFLOW_DATA);
  });
  await page.route(apiPathPattern('/api/notifications'), async (route) => {
    const requestUrl = new URL(route.request().url());
    if (
      requestUrl.searchParams.get('limit') === '12' &&
      requestUrl.searchParams.get('is_read') === 'false'
    ) {
      unreadNotificationRequests.push(requestUrl);
    }

    await fulfillJson(route, { data: [], hasMore: false, nextCursor: null });
  });
  await page.route(apiPathPattern('/api/nav-badges'), (route) =>
    fulfillJson(route, { data: { notifications: 0, handoff: 0, audits: 0 } }),
  );
  await page.route(apiPathPattern('/api/dispense-audits'), (route) =>
    fulfillJson(route, { data: [], hasMore: false }),
  );
  await page.route(apiPathPattern('/api/handoff-board'), (route) =>
    fulfillJson(route, {
      data: {
        id: 'network_smoke_handoff',
        items: [],
        month_item_count: 0,
        shift_date: '2026-06-17',
        summary: { incoming_count: 0, outgoing_count: 0 },
      },
    }),
  );

  return { workflowRequests, unreadNotificationRequests };
}

function trackNotificationStream(
  page: Page,
  streamRequests: string[],
  streamContentTypes: string[],
) {
  page.on('request', (request) => {
    if (isApiPath(request.url(), STREAM_PATH)) {
      streamRequests.push(request.url());
    }
  });
  page.on('response', (response) => {
    if (isApiPath(response.url(), STREAM_PATH)) {
      streamContentTypes.push(response.headers()['content-type'] ?? '');
    }
  });
}

test.describe('comment realtime network smoke', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('keeps shared notification streams and avoids idle fallback polling while connected', async ({
    context,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'network timing smoke runs only on chromium');
    test.setTimeout(180_000);

    const collaboration = await createInstrumentedPage(context);
    const notifications = await createInstrumentedPage(context);
    const realtimeAdmin = await createInstrumentedPage(context);
    const streamRequests: string[] = [];
    const streamContentTypes: string[] = [];
    trackNotificationStream(collaboration.page, streamRequests, streamContentTypes);
    trackNotificationStream(notifications.page, streamRequests, streamContentTypes);
    trackNotificationStream(realtimeAdmin.page, streamRequests, streamContentTypes);

    const { commentGetRequests } = await installCollaborationNetworkMocks(collaboration.page);
    const { inboxRequests } = await installNotificationsNetworkMocks(notifications.page);
    const { workflowRequests, unreadNotificationRequests } = await installAdminRealtimeNetworkMocks(
      realtimeAdmin.page,
    );

    await openStableRoute(
      collaboration.page,
      `/patients/${COLLABORATION_PATIENT_ID}/collaboration`,
    );
    await expect(collaboration.page.getByTestId('collaboration-comments')).toBeVisible({
      timeout: 30_000,
    });
    await expect(collaboration.page.getByText('コメントはまだありません。')).toBeVisible({
      timeout: 15_000,
    });

    await openStableRoute(notifications.page, '/notifications');
    await expect(notifications.page.getByTestId('notifications-inbox')).toBeVisible({
      timeout: 30_000,
    });

    await openStableRoute(realtimeAdmin.page, '/admin/realtime');
    await expect(
      realtimeAdmin.page.getByRole('heading', { name: 'リアルタイム運用監視' }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(realtimeAdmin.page.getByText('ライブワークベンチ')).toBeVisible();

    await expect.poll(() => commentGetRequests.length, { timeout: 15_000 }).toBeGreaterThan(0);
    await expect.poll(() => inboxRequests.length, { timeout: 15_000 }).toBeGreaterThan(0);
    await expect.poll(() => workflowRequests.length, { timeout: 15_000 }).toBeGreaterThan(0);
    await expect
      .poll(() => unreadNotificationRequests.length, { timeout: 15_000 })
      .toBeGreaterThan(0);
    await expect.poll(() => streamRequests.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(3);
    await expect
      .poll(() => streamContentTypes.length, { timeout: 15_000 })
      .toBeGreaterThanOrEqual(3);
    expect(
      streamContentTypes.every((contentType) => contentType.includes('text/event-stream')),
    ).toBe(true);
    expect(streamRequests.some((url) => new URL(url).searchParams.has('presence'))).toBe(true);

    const countsAfterConnection = {
      comments: commentGetRequests.length,
      inbox: inboxRequests.length,
      streams: streamRequests.length,
      unreadNotifications: unreadNotificationRequests.length,
      workflow: workflowRequests.length,
    };
    await realtimeAdmin.page.waitForTimeout(65_000);

    expect(commentGetRequests).toHaveLength(countsAfterConnection.comments);
    expect(inboxRequests).toHaveLength(countsAfterConnection.inbox);
    expect(workflowRequests).toHaveLength(countsAfterConnection.workflow);
    expect(unreadNotificationRequests).toHaveLength(countsAfterConnection.unreadNotifications);
    expect(streamRequests).toHaveLength(countsAfterConnection.streams);
    expect([...collaboration.errors, ...notifications.errors, ...realtimeAdmin.errors]).toEqual([]);
  });
});
