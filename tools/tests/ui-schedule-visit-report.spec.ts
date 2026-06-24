import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  ensureGroupedVisitFixtures,
  ensureTodayVisitPreparationBoardFixtures,
} from './helpers/grouped-visit-fixtures';
import {
  ensureScheduleVehicleResourceFixtures,
  SCHEDULE_VEHICLE_FIXTURE_IDS as SCHEDULE_OPTIMIZER_IDS,
} from './helpers/schedule-vehicle-resource-fixtures';
import {
  attachLocalSession,
  clickAndWaitForStableRoute,
  createInstrumentedPage,
  openStableRoute,
  reloadStablePage,
  waitForStableUi,
} from './helpers/local-auth';
import { apiPathPattern, fulfillJson, readRouteBody } from './helpers/route-mocks';

test.setTimeout(240_000);
test.use({ serviceWorkers: 'block' });

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function openScheduleBoard(page: Page) {
  const teamBoard = page.getByTestId('schedule-team-board');
  await openStableRouteUntilVisible(page, '/schedules', () => teamBoard, {
    attempts: 3,
    timeout: 60_000,
  });

  await expect(teamBoard).toBeVisible({ timeout: 45_000 });

  const boardSettled = () =>
    teamBoard
      .getByTestId('schedule-team-gantt')
      .or(teamBoard.getByText('スケジュールを表示できません'));

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (
      await boardSettled()
        .isVisible({ timeout: 30_000 })
        .catch(() => false)
    ) {
      return;
    }

    const bodyText = (
      (await page
        .locator('body')
        .textContent()
        .catch(() => '')) ?? ''
    ).trim();
    if (!bodyText || attempt < 2) {
      await reloadStablePage(page);
      await expect(teamBoard).toBeVisible({ timeout: 45_000 });
    }
  }

  await expect(boardSettled()).toBeVisible({ timeout: 60_000 });
}

async function openVisitRecordPage(page: Page, url: string) {
  await openStableRoute(page, url);

  const switcher = page.getByTestId('facility-visit-record-switcher');
  if (!(await switcher.isVisible({ timeout: 60_000 }).catch(() => false))) {
    await reloadStablePage(page);
  }
}

async function openAdminMasterHub(page: Page) {
  await openStableRoute(page, '/admin');

  const masterHub = page.getByTestId('master-hub');
  await expect(page.getByRole('heading', { name: 'マスター', exact: true })).toBeVisible();
  await expect(masterHub).toBeVisible();

  const firstCard = masterHub.getByTestId('master-hub-card').first();
  if (!(await firstCard.isVisible({ timeout: 45_000 }).catch(() => false))) {
    await reloadStablePage(page);
    await expect(page.getByRole('heading', { name: 'マスター', exact: true })).toBeVisible();
    await expect(masterHub).toBeVisible();
  }

  await expect(firstCard).toBeVisible({ timeout: 90_000 });
}

async function expectNoPageHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return {
      clientWidth: root.clientWidth,
      scrollWidth: root.scrollWidth,
    };
  });

  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 2);
}

async function expectNoLocatorHorizontalOverflow(locator: Locator) {
  const overflow = await locator.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));

  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 2);
}

async function expectMinTouchTargetHeight(locator: Locator, minHeight = 44) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (!box) throw new Error('Touch target was not measurable');

  expect(box.height).toBeGreaterThanOrEqual(minHeight);
}

async function openStableRouteUntilVisible(
  page: Page,
  path: string,
  readyLocator: () => Locator,
  options: { attempts?: number; timeout?: number } = {},
) {
  const attempts = options.attempts ?? 2;
  const timeout = options.timeout ?? 60_000;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await openStableRoute(page, path);
    const hasBodyText = await expect
      .poll(
        async () =>
          (
            (await page
              .locator('body')
              .textContent()
              .catch(() => '')) ?? ''
          ).trim().length,
        { timeout: Math.min(timeout, 10_000) },
      )
      .toBeGreaterThan(0)
      .then(() => true)
      .catch(() => false);
    if (!hasBodyText) continue;

    if (
      await readyLocator()
        .isVisible({ timeout })
        .catch(() => false)
    ) {
      return;
    }
  }

  await expect(readyLocator()).toBeVisible({ timeout });
}

type ProposalDashboardState = 'detail' | 'empty' | 'loading' | 'blank' | 'pending';

async function waitForProposalDashboardState(
  page: Page,
  main: Locator,
  timeout: number,
): Promise<ProposalDashboardState> {
  const deadline = Date.now() + timeout;
  let lastState: ProposalDashboardState = 'pending';

  while (Date.now() < deadline) {
    const bodyText = (
      (await page
        .locator('body')
        .textContent()
        .catch(() => '')) ?? ''
    ).trim();
    if (!bodyText) {
      lastState = 'blank';
    } else if ((await page.getByRole('button', { name: /確定フローを開く/ }).count()) > 0) {
      return 'detail';
    } else if (
      await main
        .getByText('条件に一致する訪問候補はありません。')
        .isVisible()
        .catch(() => false)
    ) {
      lastState = 'empty';
    } else if (bodyText.includes('訪問候補を読み込み中')) {
      lastState = 'loading';
    } else {
      lastState = 'pending';
    }

    await page.waitForTimeout(1_000);
  }

  return lastState;
}

type WeeklyOptimizerState = 'generation' | 'shift-empty' | 'no-pharmacists' | 'loading' | 'pending';

async function waitForWeeklyOptimizerState(
  page: Page,
  main: Locator,
  timeout: number,
): Promise<WeeklyOptimizerState> {
  const deadline = Date.now() + timeout;
  let lastState: WeeklyOptimizerState = 'pending';

  while (Date.now() < deadline) {
    const text = (await main.textContent()) ?? '';
    if (text.includes('この枠に提案')) {
      return 'generation';
    }
    if (text.includes('勤務シフトなし')) {
      return 'shift-empty';
    }
    if (text.includes('対象週に勤務シフトがある薬剤師がいません。')) {
      return 'no-pharmacists';
    }
    lastState = text.includes('週間最適化ビューを読み込み中...') ? 'loading' : 'pending';
    await page.waitForTimeout(1_000);
  }

  return lastState;
}

async function swipeVisitSwitcherToNext(page: Page) {
  await page.getByTestId('facility-visit-record-switcher').evaluate((element) => {
    element.dispatchEvent(
      new TouchEvent('touchstart', {
        bubbles: true,
        changedTouches: [
          new Touch({
            identifier: 1,
            target: element,
            clientX: 320,
            clientY: 120,
          }),
        ],
      }),
    );
    element.dispatchEvent(
      new TouchEvent('touchend', {
        bubbles: true,
        changedTouches: [
          new Touch({
            identifier: 1,
            target: element,
            clientX: 80,
            clientY: 124,
          }),
        ],
      }),
    );
  });
}

type VisitRecordSavePayload = {
  schedule_id?: unknown;
  patient_id?: unknown;
  soap_subjective?: unknown;
  soap_objective?: unknown;
  soap_assessment?: unknown;
  soap_plan?: unknown;
  structured_soap?: {
    subjective?: { free_text?: unknown };
    objective?: { free_text?: unknown };
    assessment?: { free_text?: unknown };
    plan?: { free_text?: unknown };
  };
};

async function installVisitRecordSaveStub(page: Page) {
  const payloads: VisitRecordSavePayload[] = [];

  await page.route(apiPathPattern('/api/visit-records'), async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }

    const payload = readRouteBody<VisitRecordSavePayload>(route);
    if (payload) {
      payloads.push(payload);
    }

    await fulfillJson(route, {
      record: {
        id: 'stubbed_grouped_facility_visit_record',
        version: 1,
        schedule_id: payload?.schedule_id ?? 'stubbed_schedule',
        patient_id: payload?.patient_id ?? 'stubbed_patient',
        visit_date: '2026-04-25',
        outcome_status: 'completed',
        soap_subjective: payload?.soap_subjective ?? null,
        soap_objective: payload?.soap_objective ?? null,
        soap_assessment: payload?.soap_assessment ?? null,
        soap_plan: payload?.soap_plan ?? null,
        structured_soap: payload?.structured_soap ?? null,
      },
    });
  });

  return payloads;
}

async function installGroupedFacilityScheduleStub(
  page: Page,
  ids: Awaited<ReturnType<typeof ensureGroupedVisitFixtures>>,
) {
  const schedules = new Map([
    [
      ids.facilitySchedules[0],
      {
        id: ids.facilitySchedules[0],
        patient_id: ids.facilityPatients[0],
        cycle_id: null,
        scheduled_date: '2026-04-25T00:00:00.000Z',
        schedule_status: 'ready',
        visit_type: 'regular',
        carry_items_status: 'ready',
        recurrence_rule: null,
      },
    ],
    [
      ids.facilitySchedules[1],
      {
        id: ids.facilitySchedules[1],
        patient_id: ids.facilityPatients[1],
        cycle_id: null,
        scheduled_date: '2026-04-25T00:00:00.000Z',
        schedule_status: 'ready',
        visit_type: 'regular',
        carry_items_status: 'ready',
        recurrence_rule: null,
      },
    ],
  ]);

  await page.route(
    /\/api\/visit-schedules\/e2e_grouped_facility_schedule_[^/?]+$/,
    async (route) => {
      const scheduleId = new URL(route.request().url()).pathname.split('/').pop() ?? '';
      const schedule = schedules.get(scheduleId as (typeof ids.facilitySchedules)[number]);
      if (!schedule) {
        await fulfillJson(route, { message: 'stubbed schedule not found' }, 404);
        return;
      }

      await fulfillJson(route, schedule);
    },
  );
}

async function installGroupedFacilityPreparationStub(
  page: Page,
  ids: Awaited<ReturnType<typeof ensureGroupedVisitFixtures>>,
) {
  await page.route(
    /\/api\/visit-preparations\/e2e_grouped_facility_schedule_[^/?]+$/,
    async (route) => {
      const currentScheduleId = new URL(route.request().url()).pathname.split('/').pop() ?? '';
      await fulfillJson(route, {
        data: {
          preparation: null,
          pack: {
            care_team: [],
            billing_blockers: [],
            conference_context: [],
            medication_period: {
              schedule_start_date: '2026-04-25',
              schedule_end_date: '2026-05-08',
              prescription_start_date: null,
              prescription_end_date: null,
            },
            prescription_changes: null,
            previous_visit: null,
            intake_context: {
              initial_transition_management_expected: null,
            },
            facility_parallel_context: {
              batch_id: 'e2e_grouped_facility_batch',
              label: '青空ホームE2E',
              place_kind: 'facility',
              site_name: 'サンプル薬局 本店',
              common_notes: '受付で入館証を受け取り、2Fスタッフへ声かけ',
              current_schedule_id: currentScheduleId,
              patients: [
                {
                  schedule_id: ids.facilitySchedules[0],
                  patient_id: ids.facilityPatients[0],
                  patient_name: '施設E2E 太郎',
                  unit_name: '201号室',
                  route_order: 1,
                  schedule_status: 'ready',
                  medication_start_date: '2026-04-25',
                  medication_end_date: '2026-05-08',
                  preparation_blockers_count: 0,
                  visit_record_id: null,
                  visit_outcome_status: null,
                },
                {
                  schedule_id: ids.facilitySchedules[1],
                  patient_id: ids.facilityPatients[1],
                  patient_name: '施設E2E 花子',
                  unit_name: '202号室',
                  route_order: 2,
                  schedule_status: 'ready',
                  medication_start_date: '2026-04-25',
                  medication_end_date: '2026-05-08',
                  preparation_blockers_count: 0,
                  visit_record_id: null,
                  visit_outcome_status: null,
                },
              ],
            },
          },
        },
      });
    },
  );
}

test.describe('schedule page', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('schedule page loads the current team board', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openScheduleBoard(page);

    await expect(page.getByTestId('schedule-team-board')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'スケジュール', exact: true })).toBeVisible();
    await expect(
      page.locator('main a[href="/schedules/proposals?workspace=optimizer"]').first(),
    ).toBeVisible();

    // Filter known React Query warning for visit-route-plan (tracked as BUG-002)
    const realErrors = errors.filter((e) => !e.includes('Query data cannot be undefined'));
    expect(realErrors).toEqual([]);
  });

  test('current schedule board exposes route and proposal workspaces without old day-view chrome', async ({
    context,
  }) => {
    test.slow();
    const { page, errors } = await createInstrumentedPage(context);
    await openScheduleBoard(page);

    const board = page.getByTestId('schedule-team-board');
    await expect(board.getByTestId('schedule-view-mode-toggle')).toBeVisible();
    await expect(board.getByTestId('schedule-team-gantt')).toBeVisible({ timeout: 90_000 });
    await expect(board.getByTestId('schedule-pending-proposals')).toBeVisible({
      timeout: 90_000,
    });
    await expect(board.locator('a[href="/schedules/route-compare"]').first()).toBeVisible({
      timeout: 90_000,
    });
    await expect(
      board.locator('a[href^="/schedules/proposals?workspace=dashboard"]').first(),
    ).toBeVisible();
    await expect(page.locator('#planner')).toHaveCount(0);
    await expect(page.locator('#schedule-legacy-tools')).toHaveCount(0);
    await expectNoPageHorizontalOverflow(page);

    const realErrors = errors.filter((e) => !e.includes('Query data cannot be undefined'));
    expect(realErrors).toEqual([]);
  });

  test('route compare opens the current recommended-route detail and apply confirmation', async ({
    context,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Route compare interaction coverage runs in the desktop viewport.',
    );

    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/schedules/route-compare');

    const compare = page.getByTestId('route-scenario-compare');
    await expect(compare).toBeVisible({ timeout: 90_000 });

    const detail = page.getByTestId('route-recommended-detail');
    if (await detail.isVisible().catch(() => false)) {
      await expect(detail.getByTestId('route-detail-stop').first()).toBeVisible();
      await expect(detail.getByTestId('route-detail-constraint').first()).toBeVisible();
      const applyButton = detail.getByTestId('route-detail-apply');
      await expect(applyButton).toBeVisible();
      await expectMinTouchTargetHeight(applyButton);
      await applyButton.click();
      await expect(page.getByRole('alertdialog', { name: /案.*本日のルートに適用/ })).toBeVisible();
      await expect(page.getByRole('button', { name: 'この案を使う' })).toBeVisible();
    } else {
      await expect(compare).toContainText('比較できるルート案がありません');
      await expect(compare.getByRole('link', { name: /スケジュールへ戻る/ })).toBeVisible();
    }

    await expectNoPageHorizontalOverflow(page);
    const realErrors = errors.filter((e) => !e.includes('Query data cannot be undefined'));
    expect(realErrors).toEqual([]);
  });

  test('proposal dashboard opens detail with confirmation flow and reproposal controls', async ({
    context,
  }, testInfo) => {
    test.slow();
    test.skip(
      testInfo.project.name !== 'chromium',
      'Proposal dashboard detail interaction coverage runs in the desktop viewport.',
    );

    const { page, errors } = await createInstrumentedPage(context);
    await openStableRouteUntilVisible(
      page,
      '/schedules/proposals?workspace=dashboard',
      () => page.getByLabel('ケース/患者検索'),
      { timeout: 90_000 },
    );

    await expect(page.getByLabel('ケース/患者検索')).toBeVisible();
    await expect(page.getByLabel('候補日 From')).toBeVisible();
    await expect(page.getByLabel('候補日 To')).toBeVisible();

    const main = page.locator('main');
    let dashboardState = await waitForProposalDashboardState(page, main, 90_000);
    if (
      dashboardState === 'blank' ||
      dashboardState === 'loading' ||
      dashboardState === 'pending'
    ) {
      await openStableRouteUntilVisible(
        page,
        '/schedules/proposals?workspace=dashboard',
        () => page.getByLabel('ケース/患者検索'),
        { timeout: 90_000 },
      );
      dashboardState = await waitForProposalDashboardState(page, main, 150_000);
    }
    expect(
      dashboardState,
      'proposal dashboard fixture must expose detail rows for confirmation-flow coverage',
    ).toBe('detail');

    const detailButton = page.getByRole('button', { name: /確定フローを開く/ }).first();
    await expectMinTouchTargetHeight(detailButton);
    await detailButton.click();
    await expect(page.getByTestId('schedule-proposal-active-row')).toBeVisible({
      timeout: 45_000,
    });

    const sheet = page.getByRole('dialog');
    await expect(sheet.getByTestId('proposal-confirmation-flow')).toBeVisible({
      timeout: 90_000,
    });
    await expect(sheet.getByTestId('proposal-candidate-cards')).toBeVisible();
    await expect(sheet.getByTestId('proposal-flow-steps')).toBeVisible();
    await expect(sheet.getByLabel('電話で確認した内容')).toBeVisible();
    await expect(sheet.locator('#schedule-proposal-reproposal')).toBeVisible();
    await expect(sheet.getByLabel('再提案開始日')).toBeVisible();
    await expect(sheet.getByLabel('希望時間 From')).toBeVisible();
    await expect(sheet.getByLabel('希望時間 To')).toBeVisible();
    await expect(sheet.getByLabel('候補数')).toBeVisible();
    await expect(sheet.getByRole('button', { name: /変更希望で再提案/ })).toBeVisible();
    await expectNoLocatorHorizontalOverflow(sheet);

    await expectNoPageHorizontalOverflow(page);

    const realErrors = errors.filter((e) => !e.includes('Query data cannot be undefined'));
    expect(realErrors).toEqual([]);
  });

  test('weekly optimizer exposes current route preview and generation controls', async ({
    context,
  }) => {
    test.slow();
    await ensureScheduleVehicleResourceFixtures();
    const { page, errors } = await createInstrumentedPage(context, { captureHttpErrors: false });
    const optimizerParams = new URLSearchParams({
      workspace: 'optimizer',
      week: SCHEDULE_OPTIMIZER_IDS.acceptanceDate,
      optimizer_case_id: SCHEDULE_OPTIMIZER_IDS.caseId,
      optimizer_visit_type: 'regular',
      optimizer_priority: 'normal',
      optimizer_travel_mode: 'DRIVE',
      optimizer_pharmacist_id: SCHEDULE_OPTIMIZER_IDS.userId,
      optimizer_date: SCHEDULE_OPTIMIZER_IDS.acceptanceDate,
      optimizer_time_from: '09:00',
      optimizer_time_to: '18:00',
    });
    const optimizerPath = `/schedules/proposals?${optimizerParams.toString()}`;
    await openStableRoute(page, optimizerPath);

    const main = page.locator('main');
    await expect(main.getByRole('heading', { name: '週間最適化ビュー' })).toBeVisible({
      timeout: 90_000,
    });
    await expect(main.getByLabel('提案対象ケース')).toBeVisible();
    await expect(main.getByLabel('訪問種別')).toBeVisible();
    await expect(main.getByLabel('優先度')).toBeVisible();
    await expect(main.locator('#weekly-travel-mode')).toBeVisible();
    await expect(main.locator('#weekly-vehicle-resource')).toBeVisible();
    let optimizerState = await waitForWeeklyOptimizerState(page, main, 60_000);
    if (optimizerState === 'loading' || optimizerState === 'pending') {
      await openStableRoute(page, optimizerPath);
      await expect(main.getByRole('heading', { name: '週間最適化ビュー' })).toBeVisible({
        timeout: 90_000,
      });
      await expect(main.locator('#weekly-vehicle-resource')).toBeVisible();
      optimizerState = await waitForWeeklyOptimizerState(page, main, 150_000);
    }
    expect(optimizerState, 'weekly optimizer fixture must expose a proposal-generation cell').toBe(
      'generation',
    );
    const generationButton = main.getByRole('button', { name: /この枠に提案/ }).first();
    await expect(generationButton).toBeVisible();
    await expectMinTouchTargetHeight(generationButton);
    await expect(main.getByText('選択セルのルートプレビュー')).toBeVisible();

    // Filter known React Query warning for visit-route-plan (tracked as BUG-002)
    const realErrors = errors.filter((e) => !e.includes('Query data cannot be undefined'));
    expect(realErrors).toEqual([]);
  });

  test('schedule view toggle switches between list and calendar', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/schedules');

    // Look for a view toggle (list/calendar)
    const calendarToggle = page.getByRole('button', { name: /カレンダー/ });
    const listToggle = page.getByRole('button', { name: /リスト|一覧/ });

    if (await calendarToggle.isVisible().catch(() => false)) {
      await calendarToggle.click();
      await waitForStableUi(page);

      // Calendar view should have month navigation
      await expect(
        page.getByRole('button', { name: '前月' }).or(page.getByRole('button', { name: '翌月' })),
      ).toBeVisible();

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
    await openStableRoute(page, '/schedules/proposals');

    const main = page.locator('main');
    const content = await main.textContent();
    expect(content?.trim().length).toBeGreaterThan(0);

    // Back link should be present (scoped to main to avoid sidebar)
    await expect(
      main.getByRole('link', { name: /スケジュールへ戻る|スケジュール一覧/ }),
    ).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('proposal dashboard keeps reproposal vehicle selection in the current detail flow', async ({
    context,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Reproposal form coverage runs in the desktop viewport.',
    );

    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/schedules/proposals?workspace=dashboard');

    const detailButton = page.getByRole('button', { name: /確定フローを開く/ }).first();
    await expect(detailButton).toBeVisible({ timeout: 90_000 });

    await detailButton.click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.locator('#schedule-proposal-reproposal')).toBeVisible({ timeout: 45_000 });

    const vehicleSelect = sheet.locator('#reproposal-vehicle-resource');
    await expect(vehicleSelect).toBeVisible();
    await expectMinTouchTargetHeight(vehicleSelect);
    await vehicleSelect.click();
    await expect(page.getByRole('option', { name: '自動割当' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet.getByRole('button', { name: /変更希望で再提案/ })).toBeVisible();
    await expectNoLocatorHorizontalOverflow(sheet);

    const realErrors = errors.filter((e) => !e.includes('Query data cannot be undefined'));
    expect(realErrors).toEqual([]);
  });
});

test.describe('visits page', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('visits page loads the current preparation workspace', async ({ context }) => {
    await ensureTodayVisitPreparationBoardFixtures(localDateKey());
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/visits');

    const main = page.locator('main');
    await expect(page.getByTestId('visits-today')).toBeVisible();
    await expect(main.getByRole('heading', { name: '訪問', exact: true })).toBeVisible();
    const visitModeLink = main.getByRole('link', { name: '訪問モードを開始' });
    if (!(await visitModeLink.isVisible({ timeout: 60_000 }).catch(() => false))) {
      await reloadStablePage(page);
      await expect(page.getByTestId('visits-today')).toBeVisible({ timeout: 45_000 });
    }
    await expect(visitModeLink).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('visits-today-list')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('visits workspace shows preparation cards or a clear empty state', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/visits');

    const main = page.locator('main');
    await expect(page.getByTestId('visits-today')).toBeVisible({ timeout: 45_000 });

    await expect
      .poll(
        async () => {
          const hasCards = (await main.getByTestId('visit-prep-card').count()) > 0;
          const hasEmpty = await main
            .getByText('今日の訪問予定はありません。')
            .isVisible()
            .catch(() => false);
          return hasCards || hasEmpty;
        },
        { message: 'visits workspace should settle with cards or an empty state', timeout: 60_000 },
      )
      .toBe(true);

    expect(errors).toEqual([]);
  });

  test('visit detail page loads from visits list', async ({ context }) => {
    test.slow();
    await ensureTodayVisitPreparationBoardFixtures(localDateKey());
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/visits');

    const firstVisitLink = page.getByRole('link', { name: '訪問モードを開始' });
    await expect(firstVisitLink).toBeVisible({ timeout: 90_000 });
    const firstVisitHref = await firstVisitLink.getAttribute('href');
    if (!firstVisitHref) throw new Error('Visit mode link did not expose an href');
    expect(firstVisitHref).toMatch(/^\/visits\/[^/]+\/record$/);
    const firstVisitUrlPattern = new RegExp(`${escapeRegExp(firstVisitHref)}$`);

    const readinessSection = page.locator('#visit-step-readiness');
    await openStableRouteUntilVisible(page, firstVisitHref, () => readinessSection, {
      attempts: 4,
      timeout: 90_000,
    });
    await expect(page).toHaveURL(firstVisitUrlPattern);
    await expect(readinessSection).toBeVisible({ timeout: 90_000 });
    await expect(readinessSection).toContainText('訪問前確認');

    const viewportSize = page.viewportSize();
    if (viewportSize && viewportSize.width >= 768) {
      await expect(page.getByRole('heading', { name: '訪問記録入力' })).toBeVisible({
        timeout: 90_000,
      });
      await expect(page.getByRole('link', { name: '訪問一覧へ戻る' })).toBeVisible();
    } else {
      await expect(page.getByRole('heading', { name: '訪問前確認' })).toBeVisible({
        timeout: 90_000,
      });
    }

    expect(errors).toEqual([]);
  });

  test('visits workspace exposes card, route, set, and offline guidance', async ({ context }) => {
    await ensureTodayVisitPreparationBoardFixtures(localDateKey());
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/visits');

    const main = page.locator('main');
    await expect(page.getByTestId('visits-today')).toBeVisible({ timeout: 45_000 });
    await expect(main.getByRole('link', { name: /カードへ/ }).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(main.getByRole('link', { name: /ルート詳細/ }).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(main.getByRole('link', { name: /セットへ/ }).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId('visits-today-offline-note')).toContainText(
      'オフラインでも全機能',
    );

    expect(errors).toEqual([]);
  });

  test('grouped facility and private-home visit record pages render from database context', async ({
    context,
  }) => {
    test.slow();
    const ids = await ensureGroupedVisitFixtures();
    await attachLocalSession(context);
    const { page, errors } = await createInstrumentedPage(context);

    await page.setViewportSize({ width: 390, height: 844 });
    await openVisitRecordPage(page, `/visits/${ids.facilitySchedules[0]}/record`);
    await expect(page.getByTestId('facility-visit-record-switcher')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByLabel('施設並行訪問の患者切替')).toBeVisible();
    await expect(page.getByText('施設並行訪問')).toBeVisible();
    await expect(page.getByText('訪問先全体の進捗')).toBeVisible();
    await expect(page.getByText('訪問先共通メモ')).toBeVisible();
    await expect(page.getByText('受付で入館証を受け取り、2Fスタッフへ声かけ')).toBeVisible();
    await expect(page.getByText('服用 4/25-5/8').first()).toBeVisible();
    await expect(page.getByRole('link', { name: /次: 施設E2E 花子/ })).toBeVisible();
    await expectNoPageHorizontalOverflow(page);

    await swipeVisitSwitcherToNext(page);
    await waitForStableUi(page);
    await expect(page).toHaveURL(new RegExp(`/visits/${ids.facilitySchedules[1]}/record`));
    await expect(page.getByText('現在の患者')).toBeVisible();
    await expect(page.getByText('施設E2E 花子').first()).toBeVisible();

    await page.setViewportSize({ width: 768, height: 1024 });
    await openVisitRecordPage(page, `/visits/${ids.homeSchedules[0]}/record`);
    await expect(page.getByTestId('facility-visit-record-switcher')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByLabel('同一個人宅訪問の患者切替')).toBeVisible();
    await expect(page.getByText('同一個人宅訪問')).toBeVisible();
    await expect(page.getByText('山田宅E2E')).toBeVisible();
    await expect(page.getByText('訪問先全体の進捗')).toBeVisible();
    await expect(page.getByRole('link', { name: /次: 山田E2E 花子/ })).toBeVisible();
    await expectNoPageHorizontalOverflow(page);

    expect(errors).toEqual([]);
  });

  test('grouped facility visit record form stubs save payload and advances to next patient', async ({
    context,
  }) => {
    const ids = await ensureGroupedVisitFixtures();
    await attachLocalSession(context);
    const { page, errors } = await createInstrumentedPage(context);
    await page.setViewportSize({ width: 1280, height: 900 });
    const savePayloads = await installVisitRecordSaveStub(page);
    await installGroupedFacilityScheduleStub(page, ids);
    await installGroupedFacilityPreparationStub(page, ids);

    await openVisitRecordPage(page, `/visits/${ids.facilitySchedules[0]}/record`);

    await expect(page.getByTestId('facility-visit-record-switcher')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText('施設E2E 太郎').first()).toBeVisible();

    const soap = {
      subjective: 'E2E grouped S: 服薬できているが眠気あり',
      objective: 'E2E grouped O: 残薬2包、血圧安定',
      assessment: 'E2E grouped A: アドヒアランス良好、眠気は経過観察',
      plan: 'E2E grouped P: 次患者へ移動後、医師へ眠気を共有',
    };

    await page.getByLabel('主観情報').fill(soap.subjective);
    await page.getByLabel('客観情報').fill(soap.objective);
    await page.getByLabel('薬学的評価').fill(soap.assessment);
    await page.getByLabel('計画・介入').fill(soap.plan);

    await page.getByRole('checkbox', { name: '服薬状況を確認した' }).check();
    await page.getByRole('checkbox', { name: '残薬を確認した' }).check();
    await page.getByRole('checkbox', { name: '副作用・有害事象を確認した' }).check();
    await page.getByRole('checkbox', { name: '重複投薬・相互作用を確認した' }).check();
    await page.getByRole('checkbox', { name: '夜間休日の連絡体制を確認した' }).check();

    await page.getByRole('button', { name: '保存', exact: true }).click();

    await expect
      .poll(() => savePayloads.length, { message: 'visit record save payload was captured' })
      .toBe(1);

    const payload = savePayloads[0];
    expect(payload).toMatchObject({
      schedule_id: ids.facilitySchedules[0],
      patient_id: ids.facilityPatients[0],
      soap_subjective: soap.subjective,
      soap_objective: soap.objective,
      soap_assessment: soap.assessment,
      soap_plan: soap.plan,
    });
    expect(payload.structured_soap?.subjective?.free_text).toBe(soap.subjective);
    expect(payload.structured_soap?.objective?.free_text).toBe(soap.objective);
    expect(payload.structured_soap?.assessment?.free_text).toBe(soap.assessment);
    expect(payload.structured_soap?.plan?.free_text).toBe(soap.plan);

    await expect(page).toHaveURL(new RegExp(`/visits/${ids.facilitySchedules[1]}/record`));
    await expect(page.getByText('施設E2E 花子').first()).toBeVisible();

    expect(errors).toEqual([]);
  });
});

test.describe('reports page', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('reports page loads with current report-share workspace', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/reports');

    await expect(page.getByRole('heading', { name: '報告・共有', exact: true })).toBeVisible();
    await expect(page.getByTestId('report-share-workspace')).toBeVisible();
    await expect(page.getByTestId('report-edit-templates')).toBeVisible();
    await expect(page.getByTestId('report-today-drafts')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId('report-waiting-box')).toBeVisible();
    await expect(page.getByTestId('report-resolved-box')).toBeVisible();
    await expect(page.getByTestId('report-template-policy-bar')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('reports workspace shows draft rows or a clear empty state', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/reports');

    const main = page.locator('main');
    await expect(main.getByRole('heading', { name: '報告・共有' })).toBeVisible();
    await expect(page.getByTestId('report-today-drafts')).toBeVisible({ timeout: 45_000 });

    const hasDraftRows = (await main.getByTestId('report-draft-row').count()) > 0;
    const hasEmptyMessage = await main
      .getByText('本日の訪問予定はありません。訪問が完了すると、ここに報告の下書きが並びます。')
      .isVisible()
      .catch(() => false);

    expect(hasDraftRows || hasEmptyMessage).toBe(true);

    expect(errors).toEqual([]);
  });

  test('report detail page loads from a current workspace action', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/reports/cmnhdemorep002amq9ph-os');

    const main = page.locator('main');
    await expect(main).toBeVisible();
    const content = await main.textContent();
    expect(content?.trim().length).toBeGreaterThan(0);
    await expect(main.getByRole('link', { name: /報告書一覧へ戻る|報告・共有/ })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('reports workspace exposes current waiting and template policy sections', async ({
    context,
  }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/reports');

    await expect(page.getByTestId('report-waiting-box')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole('heading', { name: '返信待ち' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '今日解決した待ち' })).toBeVisible();
    await expect(page.getByTestId('report-template-policy-bar')).toContainText(
      'テンプレートは宛先ごとに自動選択',
    );

    expect(errors).toEqual([]);
  });
});

test.describe('admin master hub', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('admin master hub loads with current master cards', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openAdminMasterHub(page);

    await expect(page.getByRole('heading', { name: '管理者ダッシュボード' })).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test('admin master hub cross search opens without errors', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/admin');
    const crossSearchLink = page.getByRole('link', { name: 'マスター横断検索' });
    await expect(crossSearchLink).toBeVisible({ timeout: 45_000 });

    await clickAndWaitForStableRoute(
      page,
      /\/admin\/data-explorer/,
      () => crossSearchLink.click({ noWaitAfter: true }),
      { timeout: 90_000 },
    );

    await expect(page).toHaveURL(/\/admin\/data-explorer/);
    await expect(page.locator('main')).toContainText(/データ探索|マスター横断検索/);

    expect(errors).toEqual([]);
  });
});
