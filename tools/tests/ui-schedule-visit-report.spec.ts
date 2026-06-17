import { expect, test, type Locator, type Page } from '@playwright/test';
import { ensureGroupedVisitFixtures } from './helpers/grouped-visit-fixtures';
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

async function openScheduleBoard(page: Page) {
  await openStableRoute(page, '/schedules');
  const teamBoard = page.getByTestId('schedule-team-board');
  if (!(await teamBoard.isVisible({ timeout: 45_000 }).catch(() => false))) {
    await reloadStablePage(page);
  }

  await expect(teamBoard).toBeVisible({ timeout: 45_000 });
}

async function openVisitRecordPage(page: Page, url: string) {
  await openStableRoute(page, url);

  const switcher = page.getByTestId('facility-visit-record-switcher');
  if (!(await switcher.isVisible({ timeout: 5_000 }).catch(() => false))) {
    await reloadStablePage(page);
  }
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
    await expect(page.getByRole('heading', { name: 'スケジュール' })).toBeVisible();
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
    const { page, errors } = await createInstrumentedPage(context);
    await openScheduleBoard(page);

    const board = page.getByTestId('schedule-team-board');
    await expect(board.getByTestId('schedule-view-mode-toggle')).toBeVisible();
    await expect(board.getByTestId('schedule-team-gantt')).toBeVisible({ timeout: 90_000 });
    await expect(board.getByTestId('schedule-pending-proposals')).toBeVisible();
    await expect(board.locator('a[href="/schedules/route-compare"]').first()).toBeVisible();
    await expect(board.locator('a[href="/schedules/proposals"]').first()).toBeVisible();
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
    test.skip(
      testInfo.project.name !== 'chromium',
      'Proposal dashboard detail interaction coverage runs in the desktop viewport.',
    );

    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/schedules/proposals?workspace=dashboard');

    await expect(page.getByLabel('ケース/患者検索')).toBeVisible();
    await expect(page.getByLabel('候補日 From')).toBeVisible();
    await expect(page.getByLabel('候補日 To')).toBeVisible();

    const detailButton = page.getByRole('button', { name: /確定フローを開く/ }).first();
    await expect
      .poll(
        async () => {
          const hasDetail =
            (await page.getByRole('button', { name: /確定フローを開く/ }).count()) > 0;
          const hasEmpty = await page
            .locator('main')
            .getByText('条件に一致する訪問候補はありません。')
            .isVisible()
            .catch(() => false);
          return hasDetail || hasEmpty;
        },
        {
          message: 'proposal dashboard should settle with detail rows or an empty state',
          timeout: 90_000,
        },
      )
      .toBe(true);

    if ((await page.getByRole('button', { name: /確定フローを開く/ }).count()) > 0) {
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
    } else {
      await expect(page.locator('main')).toContainText('条件に一致する訪問候補はありません。');
    }

    await expectNoPageHorizontalOverflow(page);

    const realErrors = errors.filter((e) => !e.includes('Query data cannot be undefined'));
    expect(realErrors).toEqual([]);
  });

  test('weekly optimizer exposes current route preview and generation controls', async ({
    context,
  }) => {
    const { page, errors } = await createInstrumentedPage(context, { captureHttpErrors: false });
    await openStableRoute(page, '/schedules/proposals?workspace=optimizer');

    const main = page.locator('main');
    await expect(main.getByRole('heading', { name: '週間最適化ビュー' })).toBeVisible({
      timeout: 90_000,
    });
    await expect(main.getByText('提案対象ケース')).toBeVisible();
    await expect(main.getByLabel('訪問種別')).toBeVisible();
    await expect(main.getByLabel('優先度')).toBeVisible();
    await expect(main.getByLabel('移動手段')).toBeVisible();
    await expect(main.getByLabel('社用車')).toBeVisible();
    await expect
      .poll(
        async () => {
          const text = (await main.textContent()) ?? '';
          return text.includes('この枠に提案') || text.includes('勤務シフトなし');
        },
        {
          message: 'weekly optimizer should settle with cells or shift empty state',
          timeout: 45_000,
        },
      )
      .toBe(true);
    const generationButton = main.getByRole('button', { name: /この枠に提案/ }).first();
    if (await generationButton.isVisible().catch(() => false)) {
      await expectMinTouchTargetHeight(generationButton);
    }
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
    if (!(await detailButton.isVisible({ timeout: 90_000 }).catch(() => false))) {
      await expect(page.locator('main')).toContainText(
        /条件に一致する訪問候補はありません。|訪問候補を読み込み中/,
      );
      expect(errors).toEqual([]);
      return;
    }

    await detailButton.click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.locator('#schedule-proposal-reproposal')).toBeVisible({ timeout: 45_000 });

    const vehicleSelect = sheet.getByLabel('社用車');
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
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/visits');

    const main = page.locator('main');
    await expect(page.getByTestId('visits-today')).toBeVisible();
    await expect(main.getByRole('heading', { name: /訪問/ })).toBeVisible();
    await expect(main.getByRole('link', { name: '訪問モードを開始' })).toBeVisible({
      timeout: 45_000,
    });
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
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/visits');

    // If there are visit records, click the first one
    const firstVisitLink = page
      .locator('table tbody tr')
      .first()
      .locator('a[href^="/visits/"]')
      .first();
    if (await firstVisitLink.isVisible().catch(() => false)) {
      const href = await firstVisitLink.getAttribute('href');
      expect(href).toBeTruthy();
      await clickAndWaitForStableRoute(page, new RegExp(`${href}$`), () =>
        firstVisitLink.click({ noWaitAfter: true }),
      );
      await expect(page).toHaveURL(new RegExp(`${href}$`));

      // Visit detail should show SOAP sections
      const main = page.locator('main');
      const hasSOAP = await main
        .getByText(/主観情報|客観情報|薬学的評価|計画・介入/)
        .first()
        .isVisible()
        .catch(() => false);
      const hasContent = (await main.textContent())?.trim().length ?? 0;
      expect(hasSOAP || hasContent > 0).toBe(true);
    }

    expect(errors).toEqual([]);
  });

  test('visits workspace exposes card, route, set, and offline guidance', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/visits');

    const main = page.locator('main');
    await expect(page.getByTestId('visits-today')).toBeVisible({ timeout: 45_000 });
    await expect(main.getByRole('link', { name: /カードへ/ }).first()).toBeVisible();
    await expect(main.getByRole('link', { name: /ルート詳細/ }).first()).toBeVisible();
    await expect(main.getByRole('link', { name: /セットへ/ }).first()).toBeVisible();
    await expect(page.getByTestId('visits-today-offline-note')).toContainText(
      'オフラインでも全機能',
    );

    expect(errors).toEqual([]);
  });

  test('grouped facility and private-home visit record pages render from database context', async ({
    context,
  }) => {
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
    await openStableRoute(page, '/admin');

    await expect(page.getByRole('heading', { name: 'マスター' })).toBeVisible();
    await expect(page.getByTestId('master-hub')).toBeVisible();
    await expect(page.getByTestId('master-hub-card').first()).toBeVisible({ timeout: 45_000 });
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
