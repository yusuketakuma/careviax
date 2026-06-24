import { expect, test, type APIResponse, type Locator, type Page } from '@playwright/test';
import { Client } from 'pg';
import {
  attachLocalSession,
  clickAndWaitForStableRoute,
  createInstrumentedPage,
  openStableRoute,
  reloadStablePage,
  waitForStableUi,
} from './helpers/local-auth';
import { apiPathPattern, fulfillJson, readRouteBody } from './helpers/route-mocks';

const E2E_DB_CONNECTION_STRING = (
  process.env.DATABASE_URL ?? 'postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public'
).replace(/\?.*$/, '');
const SET_AUDIT_SUCCESS_PLAN_ID = 'cmnhdemosetpl002amq9ph-os';
const E2E_SETTER_USER_ID = 'e2e-independent-setter-user';

type WorkbenchPatientsPayload = {
  data: Array<{
    patient_id: string;
    name: string;
    latest_set_plan_id: string | null;
    latest_set_plan_cycle_id: string | null;
  }>;
};

type SetCalendarPayload = {
  data: {
    plan_id: string;
    cycle_id: string;
    period_start: string;
    day_count: number;
    rows: Array<{ line: { drug_name: string } }>;
  };
};

type SetAuditChainState = {
  approved_audits: number;
  set_batches: number;
  ok_batches: number;
  set_state_batches: number;
  audited_batches: number;
  cycle_status: string | null;
  visit_schedules: number;
  ready_visit_schedules: number;
  visit_schedules_with_carry_items: number;
  schedule_statuses: string[];
  set_audits_with_carry_packet_evidence: number;
  create_audit_logs: number;
  create_audit_logs_with_carry_packet_summary: number;
  create_audit_logs_with_full_carry_packet_evidence: number;
  cell_audit_logs: number;
};

type DispenseResultsPayload = {
  task_id: string;
  expected_version: number;
  lines: Array<{
    line_id: string;
    actual_quantity: number;
    actual_quantity_source?: string;
    actual_unit?: string;
    discrepancy_reason?: string;
  }>;
};

const ROUTE_MOCK_PATIENT_ID = 'dispense_route_mock_patient';
const ROUTE_MOCK_CYCLE_ID = 'dispense_route_mock_cycle';
const ROUTE_MOCK_TASK_ID = 'dispense_route_mock_task';
const ROUTE_MOCK_SET_PATIENT_ID = 'set_route_mock_patient';
const ROUTE_MOCK_SET_PLAN_ID = 'set_route_mock_plan';
const ROUTE_MOCK_SET_CYCLE_ID = 'set_route_mock_cycle';

function isTransientApiRequestError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /ECONNRESET|ECONNREFUSED|ERR_EMPTY_RESPONSE|ERR_CONNECTION_RESET|socket hang up/i.test(
    message,
  );
}

async function getWithTransientRetry(
  page: Page,
  path: string,
  options: { attempts?: number } = {},
): Promise<APIResponse> {
  const attempts = options.attempts ?? 3;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await page.request.get(path);
      if (response.ok() || response.status() < 500 || attempt === attempts - 1) {
        return response;
      }
    } catch (error) {
      if (!isTransientApiRequestError(error) || attempt === attempts - 1) {
        throw error;
      }
      lastError = error;
    }

    await page.waitForTimeout(500 * (attempt + 1));
  }

  throw lastError instanceof Error ? lastError : new Error(`GET ${path} failed transiently`);
}

async function routeMockDispenseWorkbench(page: Page) {
  await page.route(apiPathPattern('/api/dispense-workbench/patients'), async (route) => {
    await fulfillJson(route, {
      data: [
        {
          patient_id: ROUTE_MOCK_PATIENT_ID,
          cycle_id: ROUTE_MOCK_CYCLE_ID,
          name: '経路 花子',
          name_kana: 'ケイロ ハナコ',
          overall_status: 'dispensing',
          badge: 'in_progress',
          start_date: '2026-06-10',
          registered_date: '2026-06-09',
          latest_set_plan_id: null,
          latest_set_plan_cycle_id: null,
        },
      ],
    });
  });

  await page.route(apiPathPattern('/api/dispense-tasks'), async (route) => {
    await fulfillJson(route, {
      data: [{ id: ROUTE_MOCK_TASK_ID, status: 'in_progress', cycle_id: ROUTE_MOCK_CYCLE_ID }],
    });
  });

  await page.route(
    apiPathPattern(`/api/dispense-tasks/${ROUTE_MOCK_TASK_ID}/workbench`),
    async (route) => {
      await fulfillJson(route, {
        task: { id: ROUTE_MOCK_TASK_ID, status: 'in_progress', priority: 'normal', due_date: null },
        cycle: { id: ROUTE_MOCK_CYCLE_ID, overall_status: 'dispensing', version: 9 },
        patient: { id: ROUTE_MOCK_PATIENT_ID, name: '経路 花子' },
        intake: {
          id: 'dispense_route_mock_intake',
          prescribed_date: '2026-06-10',
          prescriber_institution: '経路クリニック',
          prescriber_name: '検証 医師',
        },
        previous_intake: { prescribed_date: '2026-05-20' },
        safety: {
          allergy: null,
          renal: null,
          handling_tags: [],
          swallowing: null,
          cautions: ['Route-mocked workbench smoke'],
        },
        comparison: [
          {
            key: 'cmp-1',
            drug_name: 'アムロジピン錠5mg',
            previous_label: '前回 7錠',
            current_label: '今回 14錠',
            change_type: 'days_changed',
            direction: 'increase',
            inquiry_origin: false,
          },
        ],
        count_rows: [
          {
            line_id: 'line_tablet',
            result_id: null,
            line_number: 1,
            drug_name: 'アムロジピン錠5mg',
            dose: '1回1錠',
            frequency: '朝夕食後',
            route: 'internal',
            tags: ['unit_dose'],
            is_narcotic: false,
            is_generic: true,
            prescribed_label: '14錠',
            prescribed_quantity: 14,
            start_date: '2026-06-10',
            end_date: '2026-06-23',
            days: 14,
            line_updated_at: '2026-06-10T00:00:00.000Z',
            dispensed_label: null,
            dispensed_at: null,
            dispensed_quantity: null,
            discrepancy_reason: null,
            unit: '錠',
            dispensing_method: null,
            packaging_method: 'unit_dose',
            packaging_instructions: null,
            packaging_group_id: 'group_route_mock',
          },
          {
            line_id: 'line_package',
            result_id: null,
            line_number: 2,
            drug_name: '酸化マグネシウム包',
            dose: '1回1包',
            frequency: '夕食後',
            route: 'internal',
            tags: ['unit_dose'],
            is_narcotic: false,
            is_generic: false,
            prescribed_label: '7包',
            prescribed_quantity: 7,
            start_date: '2026-06-17',
            end_date: '2026-06-23',
            days: 7,
            line_updated_at: '2026-06-11T00:00:00.000Z',
            dispensed_label: null,
            dispensed_at: null,
            dispensed_quantity: null,
            discrepancy_reason: null,
            unit: '包',
            dispensing_method: null,
            packaging_method: 'unit_dose',
            packaging_instructions: null,
            packaging_group_id: 'group_route_mock',
          },
        ],
        packaging_groups: [
          {
            id: 'group_route_mock',
            label: '朝夕食後袋',
            method: '一包化',
            slot: 'morning_evening',
            sort_order: 1,
            version: 1,
          },
        ],
        dispenser: null,
        auditor: { id: 'auditor_route_mock', name: '監査 太郎' },
        is_self_audit: false,
        has_narcotic: false,
        visit_time_label: null,
        resolved_inquiry: null,
        team_audit_total: 0,
        stock_check_date_label: null,
      });
    },
  );
}

function emptySetCalendarCell(overrides: Record<string, unknown> = {}) {
  return {
    batch_id: null,
    state: 'empty',
    quantity: null,
    carry_type: null,
    set_state: null,
    audit_state: null,
    ng_code: null,
    held_reason: null,
    version: null,
    ...overrides,
  };
}

async function routeMockSetWorkbench(page: Page) {
  await page.route(apiPathPattern('/api/dispense-workbench/patients'), async (route) => {
    await fulfillJson(route, {
      data: [
        {
          patient_id: ROUTE_MOCK_SET_PATIENT_ID,
          cycle_id: ROUTE_MOCK_SET_CYCLE_ID,
          name: '分類 太郎',
          name_kana: 'ブンルイ タロウ',
          overall_status: 'setting',
          badge: 'audited',
          start_date: '2026-06-17',
          registered_date: '2026-06-01',
          latest_set_plan_id: ROUTE_MOCK_SET_PLAN_ID,
          latest_set_plan_cycle_id: ROUTE_MOCK_SET_CYCLE_ID,
        },
      ],
    });
  });

  await page.route(
    apiPathPattern(`/api/set-plans/${ROUTE_MOCK_SET_PLAN_ID}/calendar`),
    async (route) => {
      await fulfillJson(route, {
        data: {
          plan_id: ROUTE_MOCK_SET_PLAN_ID,
          cycle_id: ROUTE_MOCK_SET_CYCLE_ID,
          cycle_version: 3,
          cycle_status: 'setting',
          set_method: 'facility_calendar',
          narcotic_classification: {
            unresolved_line_count: 1,
            status: 'needs_review',
          },
          period_start: '2026-06-17',
          period_end: '2026-06-17',
          day_count: 1,
          slots: ['morning', 'noon', 'evening', 'bedtime', 'prn'],
          rows: [
            {
              line: {
                id: 'line_unclassified',
                drug_name: 'コード未登録薬',
                dose: '1錠',
                frequency: '朝食後',
                route: 'internal',
                unit: '錠',
                packaging_instruction_tags: [],
              },
              days: [
                {
                  day_number: 1,
                  date: '2026-06-17',
                  cells: {
                    morning: emptySetCalendarCell({
                      batch_id: 'batch_unclassified_morning',
                      state: 'set',
                      quantity: 1,
                      carry_type: 'carry',
                      set_state: 'set',
                      audit_state: 'pending',
                      version: 2,
                    }),
                    noon: emptySetCalendarCell(),
                    evening: emptySetCalendarCell(),
                    bedtime: emptySetCalendarCell(),
                    prn: emptySetCalendarCell(),
                  },
                },
              ],
            },
          ],
          completion_gate: {
            total_cells: 1,
            set_cells: 1,
            pending_cells: 0,
            hold_cells: 0,
            audited_ok_cells: 0,
            audited_ng_cells: 0,
            unaudited_cells: 1,
            set_complete: true,
            audit_complete: false,
          },
        },
      });
    },
  );
}

function formatSetCalendarPeriod(start: string, dayCount: number) {
  const [yearText, monthText, dayText] = start.split('-');
  const startDate = new Date(Number(yearText), Number(monthText) - 1, Number(dayText));
  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + Math.max(1, dayCount) - 1);
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  return `${startDate.getFullYear()}/${startDate.getMonth() + 1}/${startDate.getDate()}（${weekdays[startDate.getDay()]}）〜${endDate.getMonth() + 1}/${endDate.getDate()}（${weekdays[endDate.getDay()]}）`;
}

async function waitForSetCalendarResponse(page: Page, planId: string) {
  const response = await page.waitForResponse((candidate) => {
    const url = new URL(candidate.url());
    return (
      url.pathname === `/api/set-plans/${planId}/calendar` && candidate.request().method() === 'GET'
    );
  });
  expect(response.ok()).toBe(true);
}

async function openSetWorkbenchWithRealData(page: Page, path: string) {
  await page.addInitScript(() => {
    try {
      const resetKey = 'chouzai-workbench-reset-once';
      if (window.sessionStorage.getItem(resetKey) === '1') return;
      window.localStorage.removeItem('chouzai-workbench');
      window.sessionStorage.setItem(resetKey, '1');
    } catch {
      // Ignore opaque-origin frames where Web Storage is unavailable.
    }
  });

  await openStableRoute(page, path);

  const patientsResponse = await getWithTransientRetry(
    page,
    '/api/dispense-workbench/patients?include_set_plan=1',
  );
  expect(patientsResponse.ok()).toBe(true);
  const patients = (await patientsResponse.json()) as WorkbenchPatientsPayload;
  expect(patients.data.length).toBeGreaterThan(0);

  const fallbackPlan = patients.data.find((row) => row.latest_set_plan_id);
  const planId = SET_AUDIT_SUCCESS_PLAN_ID || fallbackPlan?.latest_set_plan_id;
  expect(planId).toBeTruthy();
  const targetPatient = patients.data.find((row) => row.latest_set_plan_id === planId);
  expect(
    targetPatient,
    `Expected patients payload to include selected set plan ${planId}`,
  ).toBeTruthy();

  const calendarResponse = await getWithTransientRetry(page, `/api/set-plans/${planId}/calendar`);
  expect(calendarResponse.ok()).toBe(true);

  const calendar = (await calendarResponse.json()) as SetCalendarPayload;
  expect(calendar.data.plan_id).toBe(planId);
  expect(calendar.data.rows.length).toBeGreaterThan(0);
  expect(calendar.data.day_count).toBeGreaterThan(0);
  const periodLabel = formatSetCalendarPeriod(calendar.data.period_start, calendar.data.day_count);

  const main = page.locator('main');
  const phaseNav = page.locator('main').getByRole('navigation', { name: '工程タブ' });
  let targetPatientButton = page.locator('button').filter({ hasText: targetPatient!.name }).first();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await expect(phaseNav).toBeVisible({ timeout: 90_000 });
    if (await targetPatientButton.isVisible({ timeout: 10_000 }).catch(() => false)) {
      break;
    }
    if (attempt === 2) {
      await expect(targetPatientButton).toBeVisible({ timeout: 1_000 });
      break;
    }
    await reloadStablePage(page);
    await waitForStableUi(page);
    targetPatientButton = page.locator('button').filter({ hasText: targetPatient!.name }).first();
  }
  const isAlreadySelected = (await targetPatientButton.getAttribute('aria-current')) === 'true';
  if (!isAlreadySelected) {
    const calendarReload = waitForSetCalendarResponse(page, planId);
    await targetPatientButton.click();
    await calendarReload;
  }
  await expect(targetPatientButton).toHaveAttribute('aria-current', 'true', { timeout: 30_000 });
  await expect(phaseNav).toBeVisible({ timeout: 30_000 });
  await expect(main).toContainText(periodLabel, { timeout: 30_000 });

  return {
    planId: calendar.data.plan_id,
    cycleId: calendar.data.cycle_id,
    drugName: calendar.data.rows[0].line.drug_name,
    periodLabel,
  };
}

async function waitForSetAuditApprovalReady(main: Locator) {
  await expect(main).toContainText('✓ 全セル監査OK（承認可）', { timeout: 15_000 });
  await expect(main.getByRole('button', { name: '監査承認（薬剤師）✓' })).toBeEnabled({
    timeout: 15_000,
  });
}

async function waitForVisibleSetAuditCell(main: Locator) {
  const cell = main.getByRole('button', { name: /服薬カレンダーセル/ }).first();
  await expect(cell).toBeVisible({ timeout: 15_000 });
  return cell;
}

async function activateVisibleControl(control: Locator) {
  await expect(control).toBeVisible({ timeout: 15_000 });
  await control.scrollIntoViewIfNeeded();
  await expect(control).toBeEnabled({ timeout: 15_000 });
  await expect(control).not.toHaveAttribute('aria-disabled', 'true');
  await control.click();
}

async function markAllVisibleSetAuditCellsOk(main: Locator) {
  await waitForVisibleSetAuditCell(main);
  const cells = main.getByRole('button', { name: /服薬カレンダーセル/ });
  const cellCount = await cells.count();
  expect(cellCount).toBeGreaterThan(0);

  const pendingCells = main.getByRole('button', { name: /服薬カレンダーセル.*未監査/ });
  for (let guard = 0; guard < cellCount; guard += 1) {
    const pendingCount = await pendingCells.count();
    if (pendingCount === 0) break;

    await pendingCells.first().click();
    const okButton = main.getByRole('button', { name: '監査OK', exact: true });
    await expect(okButton).toBeEnabled({ timeout: 15_000 });
    await okButton.click();
    await expect.poll(() => pendingCells.count(), { timeout: 15_000 }).toBeLessThan(pendingCount);
  }

  await expect(pendingCells).toHaveCount(0, { timeout: 15_000 });
  await expect(
    main.getByRole('progressbar', {
      name: new RegExp(`セット監査 進捗 ${cellCount} / ${cellCount}`),
    }),
  ).toBeVisible({ timeout: 10_000 });
}

const SET_AUDIT_CHECK_LABELS = [
  '日付が正しい',
  '用法が正しい',
  '数量が正しい',
  '中止薬が混入していない',
  '残薬使用の指示と一致',
  '冷所薬を分離している',
] as const;

async function pressAllUnpressedToggleButtons(
  container: Locator,
  options?: { required?: boolean },
) {
  const toggleButtons = container.locator('button[aria-pressed]');
  const count = await toggleButtons.count();
  if (options?.required) expect(count).toBeGreaterThan(0);

  for (let index = 0; index < count; index += 1) {
    const item = toggleButtons.nth(index);
    await expect(item).toBeVisible({ timeout: 10_000 });
    if ((await item.getAttribute('aria-pressed')) !== 'true') {
      await item.click();
    }
    await expect(item).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
  }
}

async function completeSetAuditChecklist(main: Locator) {
  const targetCell = await waitForVisibleSetAuditCell(main);

  for (const label of SET_AUDIT_CHECK_LABELS) {
    await targetCell.click();
    const checkButton = main.getByRole('button', { name: label });
    await expect(checkButton).toBeEnabled({ timeout: 10_000 });
    await checkButton.click({ timeout: 10_000 });
    await expect(checkButton).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
  }
}

async function confirmVisitCarryPacketOnSetPage(main: Locator) {
  const outsideMeds = main
    .getByText('カレンダー外薬（同梱確認）', { exact: true })
    .locator('xpath=ancestor::div[1]/following-sibling::div[1]');
  await expect(outsideMeds).toBeVisible({ timeout: 10_000 });
  await pressAllUnpressedToggleButtons(outsideMeds, { required: true });

  const carryPacket = main.getByTestId('visit-carry-packet-confirmation');
  await expect(carryPacket).toBeVisible({ timeout: 10_000 });
  await pressAllUnpressedToggleButtons(carryPacket, { required: true });
}

async function clickSetAuditPhaseTabUntilStable(page: Page, main: Locator) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const setAuditLink = main.getByRole('link', { name: 'セット監査', exact: true }).first();
    await expect(setAuditLink).toBeVisible({ timeout: 45_000 });
    const setAuditHref = await setAuditLink.getAttribute('href');
    if (!setAuditHref) throw new Error('Set-audit workbench link did not expose an href');
    expect(setAuditHref).toBe('/set-audit');

    await setAuditLink.click({ noWaitAfter: true });
    const reachedSetAudit = await page
      .waitForURL(/\/set-audit/, { timeout: 45_000, waitUntil: 'domcontentloaded' })
      .then(() => true)
      .catch(() => false);
    if (reachedSetAudit) {
      await waitForStableUi(page);
      if (/\/set-audit(?:$|\?)/.test(new URL(page.url()).pathname)) {
        await expect(main.locator('a[aria-current="page"]')).toContainText('セット監査', {
          timeout: 30_000,
        });
        return;
      }
    }
  }

  throw new Error(`Set-audit phase tab did not settle on /set-audit; current URL: ${page.url()}`);
}

async function openSetAuditViaSetWithCarryEvidence(page: Page) {
  const data = await openSetWorkbenchWithRealData(page, '/set');
  const main = page.locator('main');
  await expect(main.getByRole('navigation', { name: '工程タブ' })).toBeVisible();
  await waitForVisibleSetAuditCell(main);
  await confirmVisitCarryPacketOnSetPage(main);

  await clickSetAuditPhaseTabUntilStable(page, main);
  await expect(main).toContainText(data.periodLabel, { timeout: 30_000 });
  await waitForVisibleSetAuditCell(main);
  return data;
}

function assertSafeE2eDatabase() {
  if (process.env.PLAYWRIGHT !== '1' && process.env.PLAYWRIGHT_REUSE_SERVER !== '1') {
    throw new Error('Set-audit success E2E requires PLAYWRIGHT=1 or PLAYWRIGHT_REUSE_SERVER=1');
  }

  const url = new URL(E2E_DB_CONNECTION_STRING);
  const databaseName = url.pathname.replace(/^\//, '');
  const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (!isLocalHost || databaseName !== 'ph_os_e2e') {
    throw new Error('Set-audit success E2E requires a local ph_os_e2e DATABASE_URL');
  }
}

async function withE2eDb<T>(fn: (client: Client) => Promise<T>) {
  assertSafeE2eDatabase();
  const client = new Client({ connectionString: E2E_DB_CONNECTION_STRING });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function resetSetAuditSuccessFixture(planId = SET_AUDIT_SUCCESS_PLAN_ID) {
  await withE2eDb(async (client) => {
    await client.query('BEGIN');
    try {
      const plan = await client.query<{ cycle_id: string; org_id: string }>(
        'SELECT cycle_id, org_id FROM "SetPlan" WHERE id = $1',
        [planId],
      );
      const target = plan.rows[0];
      if (!target) {
        throw new Error(`Set audit E2E plan fixture not found: ${planId}`);
      }

      await client.query('DELETE FROM "SetAudit" WHERE plan_id = $1 AND org_id = $2', [
        planId,
        target.org_id,
      ]);
      await client.query(
        `
          UPDATE "SetBatch"
          SET set_state = 'set',
              audit_state = 'unaudited',
              ng_code = NULL,
              set_by = $3,
              set_at = NOW(),
              audited_by = NULL,
              audited_at = NULL,
              held_reason = NULL,
              held_by = NULL,
              held_at = NULL,
              version = version + 1
          WHERE plan_id = $1 AND org_id = $2
        `,
        [planId, target.org_id, E2E_SETTER_USER_ID],
      );
      await client.query(
        `
          UPDATE "MedicationCycle"
          SET overall_status = 'setting',
              version = version + 1
          WHERE id = $1 AND org_id = $2
        `,
        [target.cycle_id, target.org_id],
      );
      await client.query(
        `
          UPDATE "VisitSchedule"
          SET schedule_status = 'planned',
              carry_items = NULL,
              carry_items_status = NULL,
              pre_visit_checklist_completed = TRUE,
              version = version + 1
          WHERE cycle_id = $1 AND org_id = $2
        `,
        [target.cycle_id, target.org_id],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

async function readSetAuditChainState(planId = SET_AUDIT_SUCCESS_PLAN_ID) {
  return withE2eDb(async (client) => {
    const result = await client.query<SetAuditChainState>(
      `
        WITH target_plan AS (
          SELECT id, org_id, cycle_id FROM "SetPlan" WHERE id = $1
        )
        SELECT
          (
            SELECT count(*)::int
            FROM "SetAudit" audit
            JOIN target_plan plan ON plan.id = audit.plan_id AND plan.org_id = audit.org_id
            WHERE audit.result = 'approved'
          ) AS approved_audits,
          (
            SELECT count(*)::int
            FROM "SetBatch" batch
            JOIN target_plan plan ON plan.id = batch.plan_id AND plan.org_id = batch.org_id
          ) AS set_batches,
          (
            SELECT count(*)::int
            FROM "SetBatch" batch
            JOIN target_plan plan ON plan.id = batch.plan_id AND plan.org_id = batch.org_id
            WHERE batch.audit_state = 'ok'
          ) AS ok_batches,
          (
            SELECT count(*)::int
            FROM "SetBatch" batch
            JOIN target_plan plan ON plan.id = batch.plan_id AND plan.org_id = batch.org_id
            WHERE batch.set_state = 'set'
          ) AS set_state_batches,
          (
            SELECT count(*)::int
            FROM "SetBatch" batch
            JOIN target_plan plan ON plan.id = batch.plan_id AND plan.org_id = batch.org_id
            WHERE batch.audited_by IS NOT NULL AND batch.audited_at IS NOT NULL
          ) AS audited_batches,
          (
            SELECT cycle.overall_status::text
            FROM "MedicationCycle" cycle
            JOIN target_plan plan ON plan.cycle_id = cycle.id AND plan.org_id = cycle.org_id
          ) AS cycle_status,
          (
            SELECT count(*)::int
            FROM "VisitSchedule" schedule
            JOIN target_plan plan ON plan.cycle_id = schedule.cycle_id AND plan.org_id = schedule.org_id
          ) AS visit_schedules,
          (
            SELECT count(*)::int
            FROM "VisitSchedule" schedule
            JOIN target_plan plan ON plan.cycle_id = schedule.cycle_id AND plan.org_id = schedule.org_id
            WHERE schedule.carry_items_status = 'ready'
          ) AS ready_visit_schedules,
          (
            SELECT count(*)::int
            FROM "VisitSchedule" schedule
            JOIN target_plan plan ON plan.cycle_id = schedule.cycle_id AND plan.org_id = schedule.org_id
            WHERE jsonb_typeof(schedule.carry_items::jsonb) = 'array'
              AND jsonb_array_length(schedule.carry_items::jsonb) > 0
          ) AS visit_schedules_with_carry_items,
          (
            SELECT coalesce(array_agg(DISTINCT schedule.schedule_status::text), ARRAY[]::text[])
            FROM "VisitSchedule" schedule
            JOIN target_plan plan ON plan.cycle_id = schedule.cycle_id AND plan.org_id = schedule.org_id
          ) AS schedule_statuses,
          (
            SELECT count(*)::int
            FROM "SetAudit" audit
            JOIN target_plan plan ON plan.id = audit.plan_id AND plan.org_id = audit.org_id
            WHERE audit.result = 'approved'
              AND coalesce(audit.checklist::jsonb, '{}'::jsonb) ? 'carry_packet_evidence'
          ) AS set_audits_with_carry_packet_evidence,
          (
            SELECT count(*)::int
            FROM "AuditLog" log
            JOIN "SetAudit" audit ON audit.id = log.target_id
            JOIN target_plan plan ON plan.id = audit.plan_id AND plan.org_id = audit.org_id
            WHERE log.action = 'set_audit.create'
          ) AS create_audit_logs,
          (
            SELECT count(*)::int
            FROM "AuditLog" log
            JOIN "SetAudit" audit ON audit.id = log.target_id
            JOIN target_plan plan ON plan.id = audit.plan_id AND plan.org_id = audit.org_id
            WHERE log.action = 'set_audit.create'
              AND coalesce(log.changes::jsonb, '{}'::jsonb) ? 'carry_packet_evidence_summary'
          ) AS create_audit_logs_with_carry_packet_summary,
          (
            SELECT count(*)::int
            FROM "AuditLog" log
            JOIN "SetAudit" audit ON audit.id = log.target_id
            JOIN target_plan plan ON plan.id = audit.plan_id AND plan.org_id = audit.org_id
            WHERE log.action = 'set_audit.create'
              AND coalesce(log.changes::jsonb, '{}'::jsonb) ? 'carry_packet_evidence'
          ) AS create_audit_logs_with_full_carry_packet_evidence,
          (
            SELECT count(*)::int
            FROM "AuditLog" log
            JOIN "SetBatch" batch ON batch.id = log.target_id
            JOIN target_plan plan ON plan.id = batch.plan_id AND plan.org_id = batch.org_id
            WHERE log.action = 'set_audit.cell'
          ) AS cell_audit_logs
      `,
      [planId],
    );

    const state = result.rows[0];
    if (!state) {
      throw new Error(`Set audit E2E state query returned no rows for ${planId}`);
    }
    return state;
  });
}

test.describe('prescription → QR scan → draft', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('QR scan page loads with scan interface', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/qr-scan');

    // Page should render (camera or fallback text input)
    const main = page.locator('main');
    if (!(await main.isVisible({ timeout: 45_000 }).catch(() => false))) {
      await reloadStablePage(page);
    }
    await expect(main).toBeVisible({ timeout: 90_000 });
    const content = await main.textContent();
    expect(content?.trim().length).toBeGreaterThan(0);

    expect(errors).toEqual([]);
  });

  test('QR drafts list page loads', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/prescriptions/qr-drafts');

    // Should show heading or list
    const main = page.locator('main');
    await expect(main).toBeVisible();

    // Either shows drafts or empty state
    const content = await main.textContent();
    expect(content?.trim().length).toBeGreaterThan(0);

    expect(errors).toEqual([]);
  });

  test('QR drafts list has link to QR scan', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/prescriptions/qr-drafts');

    // Should have a way to start a new scan
    const scanLink = page.getByRole('link', { name: /QRスキャン|新規スキャン|スキャン/i });
    const hasScanLink = await scanLink.isVisible().catch(() => false);

    const scanBtn = page.getByRole('button', { name: /QRスキャン|新規スキャン|スキャン/i });
    const hasScanBtn = await scanBtn.isVisible().catch(() => false);

    // Shortcut links in header area
    const headerLink = page.locator('main').getByRole('link').first();
    const hasAnyLink = await headerLink.isVisible().catch(() => false);

    expect(hasScanLink || hasScanBtn || hasAnyLink).toBe(true);

    expect(errors).toEqual([]);
  });

  test('QR draft detail page navigates from list', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/prescriptions/qr-drafts');

    // If any draft exists, clicking it should navigate to detail
    const firstDraftLink = page
      .locator('main')
      .locator('a[href*="/prescriptions/qr-drafts/"]')
      .first();
    const hasDraftLink = await firstDraftLink.isVisible().catch(() => false);

    if (hasDraftLink) {
      const href = await firstDraftLink.getAttribute('href');
      expect(href).toBeTruthy();
      await clickAndWaitForStableRoute(page, new RegExp(href!), () =>
        firstDraftLink.click({ noWaitAfter: true }),
      );

      await expect(page).toHaveURL(new RegExp(href!));

      // Draft detail should render content
      const detailContent = await page.locator('main').textContent();
      expect(detailContent?.trim().length).toBeGreaterThan(0);
    }

    expect(errors).toEqual([]);
  });
});

test.describe('prescription intake flow', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('prescription list → new intake → form renders', async ({ context }) => {
    test.slow();
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/prescriptions');

    await expect(
      page.locator('main').getByRole('heading', { name: '処方受付' }).first(),
    ).toBeVisible({ timeout: 45_000 });

    // Navigate to new intake
    const main = page.locator('main');
    const newIntakeLink = main.getByRole('link', { name: '新規受付' }).first();
    await expect(newIntakeLink).toBeVisible({ timeout: 45_000 });
    const newIntakeHref = await newIntakeLink.getAttribute('href');
    if (!newIntakeHref) throw new Error('New prescription intake link did not expose an href');
    expect(newIntakeHref).toBe('/prescriptions/new');
    await openStableRoute(page, newIntakeHref);

    await expect(page.getByRole('heading', { name: '新規処方受付' })).toBeVisible({
      timeout: 90_000,
    });

    // Required fields should be present
    await expect(page.getByRole('group', { name: '患者・ケース' })).toBeVisible();
    await expect(page.getByText('処方日')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('prescription intake navigates to dispense workbench via shortcut', async ({ context }) => {
    test.slow();
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/prescriptions');

    const main = page.locator('main');
    const dispenseShortcut = main.getByRole('link', { name: '調剤キュー' }).first();
    await expect(dispenseShortcut).toBeVisible({ timeout: 45_000 });
    const dispenseHref = await dispenseShortcut.getAttribute('href');
    if (!dispenseHref) throw new Error('Dispense shortcut did not expose an href');
    expect(dispenseHref).toBe('/dispense');
    await openStableRoute(page, dispenseHref);
    await expect(page).toHaveURL(/\/dispense/);

    // 新 DispensingWorkbench の工程タブが安定アンカー（旧「調剤」見出しは撤去済み）。
    await expect(main.getByRole('navigation', { name: '工程タブ' })).toBeVisible({
      timeout: 90_000,
    });

    expect(errors).toEqual([]);
  });
});

test.describe('dispense → audit flow', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('dispense workbench loads and shows content', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/dispense');

    // 新 DispensingWorkbench の工程タブが安定アンカー（旧「調剤」見出しは撤去済み）。
    await expect(page.locator('main').getByRole('navigation', { name: '工程タブ' })).toBeVisible();

    const content = await page.locator('main').textContent();
    expect(content?.trim().length).toBeGreaterThan(0);

    expect(errors).toEqual([]);
  });

  test('route-mocked workbench preserves key controls and submits unit-aware quantities', async ({
    context,
  }) => {
    test.slow();
    const { page, errors } = await createInstrumentedPage(context);
    let submitted: DispenseResultsPayload | null = null;

    await page.addInitScript(() => {
      try {
        window.localStorage.removeItem('chouzai-workbench');
      } catch {
        // Ignore opaque-origin frames where Web Storage is unavailable.
      }
    });
    await routeMockDispenseWorkbench(page);
    await page.route(apiPathPattern('/api/dispense-results'), async (route) => {
      submitted = readRouteBody<DispenseResultsPayload>(route);
      await fulfillJson(route, { task_id: ROUTE_MOCK_TASK_ID }, 201);
    });

    await openStableRoute(page, '/dispense');

    const main = page.locator('main');
    await expect(main.getByRole('navigation', { name: '工程タブ' })).toBeVisible();
    await expect(main.getByRole('link', { name: '調剤', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(main.getByText('患者(P)')).toHaveCount(0);
    await expect(main.getByText('調剤(C)')).toHaveCount(0);
    await expect(main.getByRole('button', { name: /前回処方と比較/ })).toBeVisible();
    await expect(main.getByRole('button', { name: /新規グループ/ })).toBeVisible();
    await expect(main.getByText('期間混在 2種類')).toBeVisible();

    const tabletQuantityInput = main.getByLabel('アムロジピン錠5mg 実数量');
    const packageQuantityInput = main.getByLabel('酸化マグネシウム包 実数量');
    await expect(tabletQuantityInput).toHaveAttribute('step', '0.5');
    await expect(packageQuantityInput).toHaveAttribute('step', '1');

    await activateVisibleControl(main.getByRole('button', { name: /前回処方と比較/ }));
    const compareDialog = main.getByRole('dialog', { name: /前回処方との比較/ });
    await expect(compareDialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(compareDialog).toBeHidden();

    await activateVisibleControl(main.getByRole('button', { name: '全て調剤済' }));
    await tabletQuantityInput.fill('12.5');
    await activateVisibleControl(
      main.getByRole('button', { name: /アムロジピン錠5mg.*実数量確認/ }),
    );
    await main.getByLabel('アムロジピン錠5mg 数量差異理由').fill('残薬調整');
    await activateVisibleControl(
      main.getByRole('button', { name: /酸化マグネシウム包.*実数量確認/ }),
    );

    await activateVisibleControl(main.getByRole('button', { name: '調剤完了 → 監査へ ▶' }));
    await expect.poll(() => submitted, { timeout: 15_000 }).not.toBeNull();
    expect(submitted).toMatchObject({
      task_id: ROUTE_MOCK_TASK_ID,
      expected_version: 9,
      lines: expect.arrayContaining([
        expect.objectContaining({
          line_id: 'line_tablet',
          actual_quantity: 12.5,
          actual_quantity_confirmed: true,
          actual_quantity_source: 'manual_entry',
          actual_unit: '錠',
          discrepancy_reason: '残薬調整',
        }),
        expect.objectContaining({
          line_id: 'line_package',
          actual_quantity: 7,
          actual_quantity_confirmed: true,
          actual_quantity_source: 'prescription_quantity_confirmed',
          actual_unit: '包',
        }),
      ]),
    });

    expect(errors).toEqual([]);
  });

  test('dispense → audit navigation works', async ({ context }) => {
    test.slow();
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/dispense');

    const main = page.locator('main');
    // 新ワークベンチは工程タブ（調剤監査 → /audit）の <Link> で遷移する。
    const auditLink = main.getByRole('link', { name: '調剤監査', exact: true }).first();
    await expect(auditLink).toBeVisible({ timeout: 45_000 });
    const auditHref = await auditLink.getAttribute('href');
    if (!auditHref) throw new Error('Audit workbench link did not expose an href');
    expect(auditHref).toBe('/audit');
    await openStableRoute(page, auditHref);
    await expect(page).toHaveURL(/\/audit/);

    // 遷移後は調剤監査工程タブが active（aria-current="page"）。
    await expect(main.locator('a[aria-current="page"]')).toBeVisible({
      timeout: 45_000,
    });

    expect(errors).toEqual([]);
  });

  test('audit workbench loads with content', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/audit');

    await expect(page.locator('main').getByRole('navigation', { name: '工程タブ' })).toBeVisible();

    const content = await page.locator('main').textContent();
    expect(content?.trim().length).toBeGreaterThan(0);

    expect(errors).toEqual([]);
  });

  test('full prescription → dispense → audit round trip', async ({ context }) => {
    test.slow();
    const { page, errors } = await createInstrumentedPage(context);

    // Start: prescriptions
    await openStableRoute(page, '/prescriptions');
    await expect(
      page.locator('main').getByRole('heading', { name: '処方受付' }).first(),
    ).toBeVisible({ timeout: 90_000 });

    // → dispense（/prescriptions 側の「調剤キュー」ショートカットは維持）
    const main = page.locator('main');
    const dispenseShortcut = main.getByRole('link', { name: '調剤キュー' }).first();
    await expect(dispenseShortcut).toBeVisible({ timeout: 45_000 });
    const dispenseShortcutHref = await dispenseShortcut.getAttribute('href');
    if (!dispenseShortcutHref) throw new Error('Dispense shortcut did not expose an href');
    expect(dispenseShortcutHref).toBe('/dispense');
    await openStableRoute(page, dispenseShortcutHref);
    await expect(page).toHaveURL(/\/dispense/);

    const phaseTabs = main.getByRole('navigation', { name: '工程タブ' });
    await expect(phaseTabs).toBeVisible({
      timeout: 45_000,
    });

    // → audit via 工程タブ（調剤監査 → /audit）
    const auditLink = phaseTabs.getByRole('link', { name: '調剤監査', exact: true }).first();
    await expect(auditLink).toHaveAttribute('href', '/audit');
    await openStableRoute(page, '/audit');
    await expect(page).toHaveURL(/\/audit/);
    await expect(main.locator('a[aria-current="page"]')).toBeVisible({
      timeout: 45_000,
    });

    // → back to dispense via 工程タブ（調剤 → /dispense）
    const dispenseLink = main.getByRole('link', { name: '調剤', exact: true }).first();
    await expect(dispenseLink).toHaveAttribute('href', '/dispense');
    await openStableRoute(page, '/dispense');
    await expect(page).toHaveURL(/\/dispense/);
    await expect(main.getByRole('navigation', { name: '工程タブ' })).toBeVisible({
      timeout: 45_000,
    });

    expect(errors).toEqual([]);
  });
});

test.describe('set → set-audit real-data direct entry', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('route-mocked set workbench shows narcotic classification review chip', async ({
    context,
  }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.addInitScript(() => {
      try {
        window.localStorage.removeItem('chouzai-workbench');
      } catch {
        // Ignore opaque-origin frames where Web Storage is unavailable.
      }
    });
    await routeMockSetWorkbench(page);

    await openStableRoute(page, '/set');

    const main = page.locator('main');
    await expect(main.getByRole('navigation', { name: '工程タブ' })).toBeVisible();
    await expect(main.getByText('麻薬分類未確認 1剤')).toBeVisible();
    await expect(main.getByText('特記なし')).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test('set workbench resolves patient SetPlan calendar data on direct entry', async ({
    context,
  }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openSetWorkbenchWithRealData(page, '/set');

    const main = page.locator('main');
    await expect(main.getByRole('navigation', { name: '工程タブ' })).toBeVisible();
    await expect(main).toContainText('セット対象期間');
    await expect(main).toContainText('一包化袋');
    await expect(main).toContainText('1包');
    expect(errors).toEqual([]);
  });

  test('set-audit workbench resolves patient SetPlan calendar data on direct entry', async ({
    context,
  }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openSetWorkbenchWithRealData(page, '/set-audit');

    const main = page.locator('main');
    await expect(main.getByRole('navigation', { name: '工程タブ' })).toBeVisible();
    await expect(main).toContainText('セット対象期間');
    await expect(main).toContainText('一包化袋');
    await expect(main).toContainText('1包');
    expect(errors).toEqual([]);
  });

  test('set-audit NG rejection requires a selected NG classification', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openSetWorkbenchWithRealData(page, '/set-audit');

    const main = page.locator('main');
    const ngClassification = main.locator('#ng-classification');
    const rejectButton = main.getByRole('button', { name: 'NG・差戻し' });
    await expect(ngClassification).toBeDisabled();
    await expect(rejectButton).toBeDisabled();

    await (await waitForVisibleSetAuditCell(main)).click();
    await expect(ngClassification).toBeEnabled();
    await ngClassification.selectOption({ label: '数量不足' });
    await expect(rejectButton).toBeEnabled();

    expect(errors).toEqual([]);
  });

  test('mobile set-audit keeps audit controls reachable without submitting approval', async ({
    context,
  }, testInfo) => {
    test.skip(
      !['Mobile Chrome', 'mobile-chromium'].includes(testInfo.project.name),
      'Mobile set-audit smoke replaces mobile coverage for fixed-fixture approval POST tests.',
    );
    const { page, errors } = await createInstrumentedPage(context);
    await page.addInitScript(() => {
      try {
        window.localStorage.removeItem('chouzai-workbench');
      } catch {
        // Ignore opaque-origin frames where Web Storage is unavailable.
      }
    });
    await routeMockSetWorkbench(page);

    await openStableRoute(page, '/set-audit');

    const main = page.locator('main');
    await expect(main.getByRole('navigation', { name: '工程タブ' })).toBeVisible();
    const cell = await waitForVisibleSetAuditCell(main);
    await cell.click();
    await expect(main.getByRole('button', { name: '監査OK', exact: true })).toBeVisible();
    await expect(main.locator('#ng-classification')).toBeEnabled();
    await expect(main.getByRole('button', { name: 'NG・差戻し' })).toBeDisabled();

    expect(errors).toEqual([]);
  });

  test('set-audit final approval stays on set-audit when the API returns a conflict', async ({
    context,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Final approval POST mutates a fixed DB fixture; mobile non-submit smoke covers responsive controls.',
    );
    await resetSetAuditSuccessFixture();

    const { page, errors } = await createInstrumentedPage(context);
    const data = await openSetAuditViaSetWithCarryEvidence(page);
    expect(data.planId).toBe(SET_AUDIT_SUCCESS_PLAN_ID);

    const main = page.locator('main');
    await markAllVisibleSetAuditCellsOk(main);
    await completeSetAuditChecklist(main);
    await waitForSetAuditApprovalReady(main);

    let approvalPayload: unknown = null;
    await page.route('**/api/set-audits', async (route) => {
      const request = route.request();
      if (request.method() !== 'POST') {
        await route.continue();
        return;
      }
      approvalPayload = request.postDataJSON();
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: 'cell_version_conflict',
          message: 'セット監査データが更新されています',
        }),
      });
    });

    const [response] = await Promise.all([
      page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname === '/api/set-audits' && response.request().method() === 'POST';
      }),
      main.getByRole('button', { name: '監査承認（薬剤師）✓' }).click(),
    ]);
    expect(response.status()).toBe(409);
    await expect(page).toHaveURL(/\/set-audit/);
    expect(approvalPayload).toMatchObject({
      plan_id: data.planId,
      result: 'approved',
      checklist: {
        date_match: true,
        timing_match: true,
        quantity_match: true,
        no_discontinued: true,
        residual_usage_ok: true,
        cold_storage_separated: true,
      },
      carry_packet_evidence: {
        schema_version: 1,
        summary: {
          all_checked: true,
        },
      },
    });
    expect(Array.isArray((approvalPayload as { cell_audits?: unknown[] }).cell_audits)).toBe(true);
    expect((approvalPayload as { cell_audits: unknown[] }).cell_audits.length).toBeGreaterThan(0);
    expect(
      (approvalPayload as { cell_audits: Array<{ expected_version?: unknown }> }).cell_audits,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          audit_state: 'ok',
          expected_version: expect.any(Number),
        }),
      ]),
    );

    expect(
      errors.filter(
        (entry) =>
          !entry.includes('http:409 http://localhost:3012/api/set-audits') &&
          !entry.includes('Failed to load resource: the server responded with a status of 409'),
      ),
    ).toEqual([]);
  });

  test('set-audit final approval persists audit, cells, cycle, and visit carry items', async ({
    context,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Final approval POST mutates a fixed DB fixture; mobile non-submit smoke covers responsive controls.',
    );
    test.slow();
    await resetSetAuditSuccessFixture();

    const { page, errors } = await createInstrumentedPage(context);
    const data = await openSetAuditViaSetWithCarryEvidence(page);
    expect(data.planId).toBe(SET_AUDIT_SUCCESS_PLAN_ID);

    const main = page.locator('main');
    await markAllVisibleSetAuditCellsOk(main);
    await completeSetAuditChecklist(main);
    await waitForSetAuditApprovalReady(main);

    const [response] = await Promise.all([
      page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname === '/api/set-audits' && response.request().method() === 'POST';
      }),
      main.getByRole('button', { name: '監査承認（薬剤師）✓' }).click(),
    ]);
    expect(response.status()).toBe(201);
    const responsePayload = (await response.json()) as { data?: { id?: string } };
    expect(responsePayload.data?.id).toBeTruthy();

    const state = await readSetAuditChainState();
    expect(state.approved_audits).toBe(1);
    expect(state.set_batches).toBeGreaterThan(0);
    expect(state.ok_batches).toBe(state.set_batches);
    expect(state.set_state_batches).toBe(state.set_batches);
    expect(state.audited_batches).toBe(state.set_batches);
    expect(state.cycle_status).toBe('set_audited');
    expect(state.visit_schedules).toBeGreaterThan(0);
    expect(state.ready_visit_schedules).toBe(state.visit_schedules);
    expect(state.visit_schedules_with_carry_items).toBe(state.visit_schedules);
    expect(state.schedule_statuses).toEqual(['planned']);
    expect(state.set_audits_with_carry_packet_evidence).toBe(1);
    expect(state.create_audit_logs).toBeGreaterThanOrEqual(1);
    expect(state.create_audit_logs_with_carry_packet_summary).toBeGreaterThanOrEqual(1);
    expect(state.create_audit_logs_with_full_carry_packet_evidence).toBe(0);
    expect(state.cell_audit_logs).toBeGreaterThanOrEqual(state.set_batches);

    expect(errors).toEqual([]);
  });
});
