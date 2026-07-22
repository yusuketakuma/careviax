import { expect, type Locator, type Page } from '@playwright/test';
import { ensureGroupedVisitFixtures } from './helpers/grouped-visit-fixtures';
import { openStableRoute, reloadStablePage } from './helpers/local-auth';
import { apiPathPattern, fulfillJson, readRouteBody } from './helpers/route-mocks';
export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function openScheduleBoard(page: Page) {
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

export async function openVisitRecordPage(page: Page, url: string) {
  await openStableRoute(page, url);

  const switcher = page.getByTestId('facility-visit-record-switcher');
  if (!(await switcher.isVisible({ timeout: 60_000 }).catch(() => false))) {
    await reloadStablePage(page);
  }
}

export async function openAdminMasterHub(page: Page) {
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

export async function expectNoPageHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return {
      clientWidth: root.clientWidth,
      scrollWidth: root.scrollWidth,
    };
  });

  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 2);
}

export async function expectNoLocatorHorizontalOverflow(locator: Locator) {
  const overflow = await locator.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));

  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 2);
}

export async function expectMinTouchTargetHeight(locator: Locator, minHeight = 44) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (!box) throw new Error('Touch target was not measurable');

  expect(box.height).toBeGreaterThanOrEqual(minHeight);
}

export async function openStableRouteUntilVisible(
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

export async function waitForProposalDashboardState(
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

export async function waitForWeeklyOptimizerState(
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

export async function swipeVisitSwitcherToNext(page: Page) {
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

export async function installVisitRecordSaveStub(page: Page) {
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
      data: {
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
      },
    });
  });

  return payloads;
}

export async function installGroupedFacilityScheduleStub(
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

      await fulfillJson(route, { data: schedule });
    },
  );
}

export async function installGroupedFacilityPreparationStub(
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
                  patient_name_kana: null,
                  patient_birth_date: null,
                  patient_gender: null,
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
                  patient_name_kana: null,
                  patient_birth_date: null,
                  patient_gender: null,
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
