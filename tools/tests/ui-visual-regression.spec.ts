import { expect, test, type Page } from '@playwright/test';
import { attachLocalSession, openStableRoute } from './helpers/local-auth';
import { STABLE_PATIENT_BOARD_RESPONSE } from './helpers/patient-board-fixture';

const stableWaitingReplies = [
  {
    id: 'visual_waiting_1',
    kind: 'report_delivery',
    waiting_days: 3,
    title: '表示確認 一郎 様 — ケアマネへの服薬状況報告',
    subtitle: '再送は前回送付の記録つきで送られます',
    actions: [
      { label: '再送する', href: '/reports/visual_waiting_1?action=resend', kind: 'button' },
    ],
  },
  {
    id: 'visual_waiting_2',
    kind: 'inquiry',
    waiting_days: 2,
    title: '表示確認 二郎 様 — 主治医への疑義照会',
    subtitle: null,
    actions: [
      { label: '依頼を確認', href: '/reports/visual_waiting_2', kind: 'button' },
      { label: '→ カードへ', href: '/patients/visual_patient_2', kind: 'link' },
    ],
  },
  {
    id: 'visual_waiting_3',
    kind: 'report_delivery',
    waiting_days: 1,
    title: '表示確認 三郎 様 — 施設看護師への残薬報告',
    subtitle: null,
    actions: [
      { label: '依頼を確認', href: '/reports/visual_waiting_3', kind: 'button' },
      { label: '→ 報告書詳細', href: '/reports/visual_waiting_3', kind: 'link' },
    ],
  },
  {
    id: 'visual_waiting_4',
    kind: 'report_delivery',
    waiting_days: 0,
    title: '表示確認 四郎 様 — 訪問後フォローアップ',
    subtitle: null,
    actions: [
      { label: '依頼を確認', href: '/reports/visual_waiting_4', kind: 'button' },
      { label: '→ 報告書詳細', href: '/reports/visual_waiting_4', kind: 'link' },
    ],
  },
  {
    id: 'visual_waiting_5',
    kind: 'inquiry',
    waiting_days: 4,
    title: '表示確認 五郎 様 — 退院時共同指導の確認',
    subtitle: null,
    actions: [
      { label: '依頼を確認', href: '/reports/visual_waiting_5', kind: 'button' },
      { label: '→ カードへ', href: '/patients/visual_patient_5', kind: 'link' },
    ],
  },
] as const;

async function stabilizeReportWaitingReplies(page: Page) {
  await page.route('**/api/care-reports/today-workspace*', async (route) => {
    const response = await route.fetch();
    if (!response.ok()) {
      await route.fulfill({ response });
      return;
    }

    const body = (await response.json()) as {
      data?: {
        waiting_replies?: unknown[];
        counts?: Record<string, number>;
        count_metadata?: { waiting?: Record<string, unknown> };
      };
    };
    if (!body.data) {
      await route.fulfill({ response });
      return;
    }

    body.data.waiting_replies = stableWaitingReplies.map((reply) => ({ ...reply }));
    if (body.data.counts) body.data.counts.waiting = stableWaitingReplies.length;
    if (body.data.count_metadata?.waiting) {
      body.data.count_metadata.waiting = {
        ...body.data.count_metadata.waiting,
        total_count: stableWaitingReplies.length,
        visible_count: stableWaitingReplies.length,
        hidden_count: 0,
        truncated: false,
      };
    }
    await route.fulfill({ response, json: body });
  });
}

async function stabilizePatientBoard(page: Page) {
  await page.route('**/api/patients/board?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(STABLE_PATIENT_BOARD_RESPONSE),
    });
  });
}

test.beforeEach(async ({ context }) => {
  await attachLocalSession(context);
});

test.describe('limited visual comparison', () => {
  test('dashboard process overview layout stays stable', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    await openStableRoute(page, '/dashboard');

    const processNow = page.getByTestId('dashboard-process-now');
    await expect(processNow).toBeVisible({ timeout: 20_000 });
    const dynamicCounts = processNow.locator('ol > li p:nth-of-type(2)');
    const dynamicBottleneckNote = processNow.locator(':scope > p');

    await expect(processNow).toHaveScreenshot('dashboard-process-now.png', {
      animations: 'disabled',
      caret: 'hide',
      mask: [dynamicCounts, dynamicBottleneckNote],
      maskColor: '#d1d5db',
    });
  });

  test('patients board layout stays stable', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    // Keep the entire board inside the viewport so Chromium paints every card row
    // included in the locator screenshot instead of leaving offscreen pixels blank.
    await page.setViewportSize({ width: 1280, height: 1600 });
    await stabilizePatientBoard(page);
    await openStableRoute(page, '/patients');

    const board = page.getByTestId('patients-board');
    await expect(board).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('patients-board-grid')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('patient-board-card').first()).toBeVisible({ timeout: 30_000 });
    const generatedAtMeta = board.locator('p').filter({ hasText: 'カードの色＝いま必要な対応' });

    await expect(board).toHaveScreenshot('patients-board.png', {
      animations: 'disabled',
      caret: 'hide',
      mask: [generatedAtMeta],
    });
  });

  test('reports workspace layout stays stable', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    await stabilizeReportWaitingReplies(page);
    await openStableRoute(page, '/reports');

    const workspace = page.getByTestId('report-share-workspace');
    await expect(workspace).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('report-waiting-box')).toBeVisible({ timeout: 30_000 });

    await expect(workspace).toHaveScreenshot('report-share-workspace.png', {
      animations: 'disabled',
      caret: 'hide',
      mask: [
        page.getByTestId('report-workspace-header-meta'),
        page.getByTestId('report-waiting-count'),
        page.getByTestId('report-waiting-days'),
      ],
      maskColor: '#d1d5db',
    });
  });

  test('reports waiting section layout stays stable', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    await stabilizeReportWaitingReplies(page);
    await openStableRoute(page, '/reports');

    const waitingBox = page.getByTestId('report-waiting-box');
    await expect(waitingBox).toBeVisible({ timeout: 20_000 });

    await expect(waitingBox).toHaveScreenshot('report-waiting-box.png', {
      animations: 'disabled',
      caret: 'hide',
      mask: [page.getByTestId('report-waiting-count'), page.getByTestId('report-waiting-days')],
      maskColor: '#d1d5db',
    });
  });
});
