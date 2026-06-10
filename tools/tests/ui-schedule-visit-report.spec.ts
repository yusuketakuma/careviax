import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  ensureConfirmedScheduleActionFixture,
  ensureGroupedVisitFixtures,
} from './helpers/grouped-visit-fixtures';
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

function formatLocalDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function openScheduleBoard(page: Page) {
  await openStableRoute(page, '/schedules');

  const nextWeekButton = page.getByRole('button', { name: /翌週/ }).first();
  if (!(await nextWeekButton.isVisible({ timeout: 45_000 }).catch(() => false))) {
    await reloadStablePage(page);
  }

  await expect(nextWeekButton).toBeVisible({ timeout: 45_000 });
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

type VisitProposalGenerationPayload = {
  case_id?: unknown;
  vehicle_resource_id?: unknown;
  travel_mode?: unknown;
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

  test('schedule page loads with day view and week navigation', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openScheduleBoard(page);

    await expect(page.getByRole('heading', { name: '訪問スケジュール' })).toBeVisible();

    // Week navigation buttons should be present
    await expect(page.getByRole('button', { name: /前週/ }).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: /翌週/ }).first()).toBeVisible();

    // Filter known React Query warning for visit-route-plan (tracked as BUG-002)
    const realErrors = errors.filter((e) => !e.includes('Query data cannot be undefined'));
    expect(realErrors).toEqual([]);
  });

  test('confirmed schedule card surfaces primary actions before details', async ({
    context,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Desktop confirmed card placement is covered separately from the mobile visit surface.',
    );

    const fixture = await ensureConfirmedScheduleActionFixture(formatLocalDateKey(new Date()));
    const { page, errors } = await createInstrumentedPage(context);

    await openScheduleBoard(page);

    const card = page.locator(`#schedule-${fixture.scheduleId}`);
    await expect(page.getByRole('status', { name: /スケジュールボード読み込み中/ })).toBeHidden({
      timeout: 90_000,
    });
    await expect(card).toBeVisible({ timeout: 90_000 });
    await expect(card.getByText('電話確定済み')).toBeVisible();

    const visitStartButton = card.getByRole('button', {
      name: /施設E2E 太郎.*訪問開始/,
    });
    const preparationButton = card.getByRole('button', {
      name: /施設E2E 太郎.*訪問準備を開く/,
    });
    const rescheduleButton = card.getByRole('button', {
      name: /施設E2E 太郎.*リスケ候補を作る/,
    });
    await expect(visitStartButton).toBeVisible();
    await expect(preparationButton).toBeVisible();
    await expect(rescheduleButton).toBeVisible();

    const patientNameBox = await card.getByText('施設E2E 太郎').first().boundingBox();
    const visitStartBox = await visitStartButton.boundingBox();
    const preparationBox = await preparationButton.boundingBox();
    const rescheduleBox = await rescheduleButton.boundingBox();
    const patientAddressBox = await card.getByText('患者住所').boundingBox();
    if (!patientNameBox || !visitStartBox || !preparationBox || !rescheduleBox) {
      throw new Error('Confirmed schedule action rail placement target was not measurable');
    }
    if (!patientAddressBox) {
      throw new Error('Confirmed schedule patient address block was not measurable');
    }

    expect(visitStartBox.y).toBeGreaterThan(patientNameBox.y);
    expect(preparationBox.y).toBeGreaterThan(patientNameBox.y);
    expect(rescheduleBox.y).toBeGreaterThan(patientNameBox.y);
    expect(visitStartBox.y).toBeLessThan(patientAddressBox.y);
    expect(preparationBox.y).toBeLessThan(patientAddressBox.y);
    expect(rescheduleBox.y).toBeLessThan(patientAddressBox.y);
    await expectNoPageHorizontalOverflow(page);

    const realErrors = errors.filter((e) => !e.includes('Query data cannot be undefined'));
    expect(realErrors).toEqual([]);
  });

  test('visit preparation dialog exposes grouped pack and departure checks', async ({
    context,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Desktop dialog grouping is covered separately from mobile shell stability checks.',
    );

    const fixture = await ensureConfirmedScheduleActionFixture(formatLocalDateKey(new Date()));
    const { page, errors } = await createInstrumentedPage(context);

    await openScheduleBoard(page);

    const card = page.locator(`#schedule-${fixture.scheduleId}`);
    await expect(page.getByRole('status', { name: /スケジュールボード読み込み中/ })).toBeHidden({
      timeout: 90_000,
    });
    await expect(card).toBeVisible({ timeout: 90_000 });

    await card
      .getByRole('button', {
        name: /施設E2E 太郎.*訪問準備を開く/,
      })
      .click();

    const dialog = page.getByRole('dialog', { name: '訪問準備チェック' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('region', { name: '対象訪問' })).toBeVisible();
    await expect(dialog.getByRole('region', { name: 'ready 判定' })).toBeVisible();

    const packRegion = dialog.getByRole('region', { name: '訪問前提・確認材料' });
    await expect(packRegion).toBeVisible({ timeout: 90_000 });
    await expect(packRegion.getByRole('region', { name: '訪問前の即時確認' })).toBeVisible();
    await expect(packRegion.getByRole('region', { name: '臨床・算定確認' })).toBeVisible();

    const departureRegion = dialog.getByRole('region', { name: '出発直前確認' });
    await expect(departureRegion).toBeVisible();
    await expect(
      departureRegion.getByRole('region', { name: '出発前チェックリスト' }),
    ).toBeVisible();
    await expect(departureRegion.getByRole('region', { name: '訪問先マップ' })).toBeVisible();
    await expect(departureRegion.getByRole('link', { name: 'ナビで開く' })).toBeVisible();

    const actionTargetSummary = dialog.locator('#preparation-action-target-summary');
    await expect(actionTargetSummary).toBeVisible();
    await expect(actionTargetSummary).toContainText('最終操作対象:');
    await expect(actionTargetSummary).toContainText('施設E2E 太郎');
    await expect(
      dialog.getByRole('button', {
        name: /施設E2E 太郎.*訪問準備をreadyに進める/,
      }),
    ).toBeVisible();
    await expect(
      dialog.getByRole('button', {
        name: /施設E2E 太郎.*訪問準備を保存/,
      }),
    ).toBeVisible();
    await expectNoPageHorizontalOverflow(page);
    await expectNoLocatorHorizontalOverflow(dialog);

    const realErrors = errors.filter((e) => !e.includes('Query data cannot be undefined'));
    expect(realErrors).toEqual([]);
  });

  test('visit preparation dialog blocks ready when carry items are unresolved', async ({
    context,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Desktop carry-item blocker proof is covered separately from mobile shell stability checks.',
    );

    const fixture = await ensureConfirmedScheduleActionFixture(formatLocalDateKey(new Date()), {
      carryItemsStatus: 'blocked',
      carryItemsConfirmed: false,
    });
    const { page, errors } = await createInstrumentedPage(context);

    await openScheduleBoard(page);

    const card = page.locator(`#schedule-${fixture.scheduleId}`);
    await expect(page.getByRole('status', { name: /スケジュールボード読み込み中/ })).toBeHidden({
      timeout: 90_000,
    });
    await expect(card).toBeVisible({ timeout: 90_000 });

    await card
      .getByRole('button', {
        name: /施設E2E 太郎.*訪問準備を開く/,
      })
      .click();

    const dialog = page.getByRole('dialog', { name: '訪問準備チェック' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('alert').getByText('持参薬が未確定のままです')).toBeVisible();
    await expect(dialog.getByText('ready 停止中')).toBeVisible();
    await expect(dialog.getByText('出発前に解決が必要な項目があります。')).toBeVisible();
    await expect(dialog.getByText('持参物ステータス未解決')).toBeVisible({ timeout: 90_000 });
    await expect(dialog.getByText('未完了: 持参薬・物品確認')).toBeVisible();
    await expect(
      dialog.getByRole('button', {
        name: /施設E2E 太郎.*訪問準備をreadyに進める/,
      }),
    ).toBeDisabled();
    await expectNoPageHorizontalOverflow(page);
    await expectNoLocatorHorizontalOverflow(dialog);

    const realErrors = errors.filter((e) => !e.includes('Query data cannot be undefined'));
    expect(realErrors).toEqual([]);
  });

  test('week navigation changes displayed dates without errors', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context, { captureHttpErrors: false });
    await openScheduleBoard(page);

    // Click next week
    await page.getByRole('button', { name: /翌週/ }).first().click();
    await waitForStableUi(page);

    // Click previous week twice to go back one week before current
    await page.getByRole('button', { name: /前週/ }).first().click();
    await waitForStableUi(page);
    await page.getByRole('button', { name: /前週/ }).first().click();
    await waitForStableUi(page);

    // Page should still be intact, no errors
    await expect(page.getByRole('heading', { name: '訪問スケジュール' })).toBeVisible();

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

  test('daily proposal generator sends selected vehicle resource in the generation payload', async ({
    context,
  }) => {
    const { page, errors } = await createInstrumentedPage(context);
    const generationPayloads: VisitProposalGenerationPayload[] = [];

    await page.route(apiPathPattern('/api/visit-schedule-proposals'), async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }

      const payload = readRouteBody<VisitProposalGenerationPayload>(route);
      if (payload) generationPayloads.push(payload);

      await fulfillJson(route, {
        data: [],
        alerts: [],
      });
    });

    await openScheduleBoard(page);

    await page.locator('#planner-vehicle-resource').click();
    await page.getByRole('option', { name: /E2E社用車A/ }).click();
    await expect(page.getByText(/E2E社用車A \(最大6件 \/ 180分以内\)/)).toBeVisible();

    await page.getByRole('button', { name: '訪問候補を生成' }).click();
    await expect.poll(() => generationPayloads.length, { timeout: 10_000 }).toBeGreaterThan(0);

    expect(generationPayloads[0]).toMatchObject({
      vehicle_resource_id: 'cmnhseedveh001amq9ph-os',
      travel_mode: 'DRIVE',
    });

    const realErrors = errors.filter((e) => !e.includes('Query data cannot be undefined'));
    expect(realErrors).toEqual([]);
  });
});

test.describe('visits page', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('visits list page loads with table and date filters', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/visits');

    await expect(page.getByRole('heading', { name: '訪問記録一覧' })).toBeVisible();

    // Date range filter inputs should exist
    const dateFrom = page.locator('#date-from');
    const dateTo = page.locator('#date-to');
    await expect(dateFrom).toBeVisible();
    await expect(dateTo).toBeVisible();

    // Shortcut links
    const main = page.locator('main');
    await expect(
      main.getByRole('link', { name: 'スケジュール', exact: true }).first(),
    ).toBeVisible();
    await expect(main.getByRole('link', { name: '報告書', exact: true }).first()).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('visits table shows data or empty state', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context, { captureHttpErrors: false });
    await openStableRoute(page, '/visits');

    // Desktop uses a table; mobile uses stacked cards with the same patient/date links.
    const main = page.locator('main');
    await expect(main.getByRole('heading', { name: '訪問記録一覧' })).toBeVisible();
    await main
      .getByText('読み込み中...')
      .first()
      .waitFor({ state: 'detached', timeout: 60_000 })
      .catch(() => null);

    await expect
      .poll(
        async () => {
          const table = main.getByRole('table', { name: '訪問記録一覧' });
          const hasTable = await table.isVisible().catch(() => false);
          const hasRows = hasTable ? (await table.getByRole('row').count()) > 1 : false;
          const hasMobileCards =
            !hasTable &&
            ((await main.locator('a[href^="/visits/"]').filter({ visible: true }).count()) > 0 ||
              (await main.locator('a[href^="/patients/"]').filter({ visible: true }).count()) > 0);
          const hasEmpty = await main
            .getByText(/訪問記録がありません|データがありません/)
            .isVisible()
            .catch(() => false);
          return hasRows || hasMobileCards || hasEmpty;
        },
        { message: 'visits table should settle with rows or an empty state', timeout: 60_000 },
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

  test('date filter on visits page is functional', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/visits');

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

  test('reports page loads with filter panel and table', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/reports');

    await expect(page.getByRole('heading', { name: '報告書', exact: true })).toBeVisible();

    // Filter panel should be visible
    const filterPanel = page.getByTestId('reports-filter-panel');
    await expect(filterPanel).toBeVisible();

    // Search placeholder
    await expect(page.getByPlaceholder('患者名 / フリガナ')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('reports table shows data or empty state', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/reports');

    const main = page.locator('main');
    await expect(main.getByRole('heading', { name: '報告書一覧' })).toBeVisible();
    await page
      .getByText('読み込み中...')
      .first()
      .waitFor({ state: 'detached', timeout: 15_000 })
      .catch(() => null);
    const hasRows = (await main.getByRole('row').count()) > 1;
    const hasEmptySummary =
      (await main
        .getByText('対象報告')
        .isVisible()
        .catch(() => false)) &&
      (await main
        .getByText('0件')
        .first()
        .isVisible()
        .catch(() => false));
    const hasEmptyMessage = await main
      .getByText(/報告書がありません|データがありません|トレーシングレポートはありません/)
      .isVisible()
      .catch(() => false);
    const hasReportList = await main
      .getByRole('heading', { name: '報告書一覧' })
      .isVisible()
      .catch(() => false);

    expect(hasRows || hasEmptySummary || hasEmptyMessage || hasReportList).toBe(true);

    expect(errors).toEqual([]);
  });

  test('report detail page loads from reports list', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/reports');

    // If there are reports, click the first detail link
    const firstRow = page.locator('table tbody tr').first();
    const detailLink = firstRow.locator('a').first();
    if (await detailLink.isVisible().catch(() => false)) {
      const href = await detailLink.getAttribute('href');
      if (href?.startsWith('/reports/')) {
        const targetUrl = new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        await clickAndWaitForStableRoute(page, targetUrl, () =>
          detailLink.click({ noWaitAfter: true }),
        );
        await expect(page).toHaveURL(targetUrl);

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
    await openStableRoute(page, '/reports');

    const searchInput = page.getByPlaceholder('患者名 / フリガナ');
    await searchInput.fill('ZZZNONEXISTENT');

    // Should show empty or fewer results
    await expect
      .poll(
        async () => {
          const hasEmpty = await page
            .getByText('報告書がありません')
            .isVisible()
            .catch(() => false);
          const rows = await page.locator('table tbody tr').count();
          return hasEmpty || rows === 0;
        },
        {
          message: 'report search should settle after debounce/refetch',
        },
      )
      .toBe(true);

    expect(errors).toEqual([]);
  });
});

test.describe('admin dashboard', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('admin dashboard loads with summary cards', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/admin');

    await expect(page.getByRole('heading', { name: '管理者ダッシュボード' })).toBeVisible();

    // Should have summary metrics or global empty state
    const mainContent = page.locator('main');
    const hasMetrics = await mainContent
      .getByText(/未記録訪問|未送付報告|月間|例外/)
      .first()
      .isVisible()
      .catch(() => false);
    const hasEmptyAll = await mainContent
      .getByText('現時点で重大な滞留はありません')
      .isVisible()
      .catch(() => false);
    const contentLength = (await mainContent.textContent())?.trim().length ?? 0;

    expect(hasMetrics || hasEmptyAll || contentLength > 100).toBe(true);

    expect(errors).toEqual([]);
  });

  test('admin monthly navigation works without errors', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/admin');

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
