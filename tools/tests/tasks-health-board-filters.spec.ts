import { expect, test, type Page } from '@playwright/test';
import { attachLocalSession, createInstrumentedPage, openStableRoute } from './helpers/local-auth';
import { apiPathPattern, fulfillJson } from './helpers/route-mocks';

function buildTaskHealthBoard(url: string) {
  const searchParams = new URL(url).searchParams;
  const scope = searchParams.get('scope') ?? 'role_default';
  const riskDomain = searchParams.get('risk_domain');

  return {
    data: {
      generated_at: '2026-07-06T00:00:00.000Z',
      scope,
      scan: {
        statuses: ['pending', 'in_progress'],
        limit: Number(searchParams.get('limit') ?? 500),
        scanned_count: 12,
        truncated: false,
      },
      summary: {
        open_count: 12,
        overdue_count: 3,
        sla_overdue_count: 2,
        unassigned_count: 1,
        patient_safety_count: riskDomain === 'medication' ? 2 : 1,
        billing_close_count: 1,
        report_delay_count: 1,
        risk_task_count: 4,
        stale_risk_task_count: 1,
        orphan_risk_task_count: 1,
      },
      task_type_groups: [
        {
          key: 'conference_action_item',
          label: 'conference_action_item',
          count: 4,
          urgent_count: 1,
          high_count: 1,
        },
      ],
      risk_domain_groups: [
        {
          key: riskDomain ?? 'medication',
          label: riskDomain === 'billing' ? '請求' : '薬剤',
          count: 4,
          urgent_count: 1,
          high_count: 1,
        },
      ],
      orphan_audit: {
        checked_count: 4,
        orphan_count: 1,
        reasons: [{ reason: 'missing_risk_key', count: 1 }],
        tasks: [
          {
            task_id: 'task_orphan',
            display_id: 'T-5001',
            task_type: 'risk_medication',
            priority: 'high',
            due_at: '2026-07-05T00:00:00.000Z',
            action_href: '/tasks?status=open&task_type=risk_medication',
          },
        ],
      },
      attention: {
        overdue_tasks: [
          {
            task_id: 'task_overdue',
            display_id: 'T-5002',
            task_type: 'risk_medication',
            priority: 'urgent',
            due_at: '2026-07-05T00:00:00.000Z',
            action_href: '/tasks?status=open&task_type=risk_medication',
          },
        ],
        sla_overdue_tasks: [],
        unassigned_tasks: [],
        stale_risk_tasks: [],
      },
    },
  };
}

async function installTaskRouteMocks(page: Page) {
  const healthBoardRequests: string[] = [];
  const taskListRequests: string[] = [];

  await page.route(apiPathPattern('/api/notifications/stream'), async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
  });
  await page.route(apiPathPattern('/api/notifications'), async (route) => {
    const url = new URL(route.request().url());
    await fulfillJson(
      route,
      url.searchParams.get('summary') === '1'
        ? { data: { unreadCount: 0 } }
        : { data: [], hasMore: false, nextCursor: null },
    );
  });
  await page.route(apiPathPattern('/api/nav-badges'), async (route) => {
    await fulfillJson(route, { data: { audit: 0, handoff: 0 } });
  });
  await page.route(apiPathPattern('/api/presence'), async (route) => {
    await fulfillJson(route, { data: route.request().method() === 'POST' ? { ok: true } : [] });
  });
  await page.route(apiPathPattern('/api/staff-workload'), async (route) => {
    await fulfillJson(route, {
      date: '2026-07-06',
      data: [
        {
          id: 'staff_1',
          name: 'スタッフA',
          role_label: '薬剤師',
          open_task_count: 2,
          today_visit_count: 3,
          dispense_task_count: 1,
          workload_score: 12,
          visits: [],
          open_tasks: [],
        },
      ],
    });
  });
  await page.route(apiPathPattern('/api/tasks/health-board'), async (route) => {
    healthBoardRequests.push(route.request().url());
    await fulfillJson(route, buildTaskHealthBoard(route.request().url()));
  });
  await page.route(apiPathPattern('/api/tasks'), async (route) => {
    taskListRequests.push(route.request().url());
    await fulfillJson(route, { data: [], hasMore: false, nextCursor: null });
  });

  return { healthBoardRequests, taskListRequests };
}

test.describe('tasks health board route-mocked filters', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('keeps health filters independent, touch-sized, and PHI-minimized', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    const { healthBoardRequests, taskListRequests } = await installTaskRouteMocks(page);

    await openStableRoute(page, '/tasks?task_type=conference_action_item');

    await expect(
      page.getByRole('heading', { name: 'オペレーショナル タスクヘルスボード' }),
    ).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() => healthBoardRequests.length, {
        message: 'task health board should fetch through the route mock',
        timeout: 15_000,
      })
      .toBeGreaterThan(0);

    expect(healthBoardRequests.at(-1)).toContain('task_type=conference_action_item');
    const scopeTrigger = page.getByRole('combobox', { name: 'ヘルス範囲' });
    const domainTrigger = page.getByRole('combobox', { name: 'リスク領域' });
    await expect(scopeTrigger).toBeVisible();
    await expect(domainTrigger).toBeVisible();

    for (const trigger of [scopeTrigger, domainTrigger]) {
      await expect
        .poll(async () => {
          const box = await trigger.boundingBox();
          return box?.height ?? 0;
        })
        .toBeGreaterThanOrEqual(44);
    }

    await domainTrigger.click();
    await page.getByRole('option', { name: '薬剤' }).click();
    await expect(page.getByText('一覧の種別フィルタとは独立して集計します。')).toBeVisible();
    await expect
      .poll(() => healthBoardRequests.at(-1) ?? '', {
        message: 'risk domain filter should refetch the health board',
        timeout: 15_000,
      })
      .toContain('risk_domain=medication');
    expect(healthBoardRequests.at(-1)).not.toContain('task_type=conference_action_item');

    await scopeTrigger.click();
    await page.getByRole('option', { name: 'チーム' }).click();
    await expect
      .poll(() => healthBoardRequests.at(-1) ?? '', {
        message: 'team scope filter should refetch only the health board',
        timeout: 15_000,
      })
      .toContain('scope=team');
    expect(taskListRequests.at(-1)).toContain('task_type=conference_action_item');

    await expect(page.getByText('東京都')).toHaveCount(0);
    await expect(page.getByText('090-')).toHaveCount(0);
    await expect(page.getByText('アムロジピン')).toHaveCount(0);

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(hasHorizontalOverflow).toBe(false);
    expect(errors).toEqual([]);
  });
});
