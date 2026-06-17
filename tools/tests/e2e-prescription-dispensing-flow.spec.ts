import { expect, test, type Locator, type Page } from '@playwright/test';
import { Client } from 'pg';
import {
  attachLocalSession,
  clickAndWaitForStableRoute,
  createInstrumentedPage,
  openStableRoute,
} from './helpers/local-auth';

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
  create_audit_logs: number;
  cell_audit_logs: number;
};

function formatSetCalendarPeriod(start: string, dayCount: number) {
  const [yearText, monthText, dayText] = start.split('-');
  const startDate = new Date(Number(yearText), Number(monthText) - 1, Number(dayText));
  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + Math.max(1, dayCount) - 1);
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  return `${startDate.getFullYear()}/${startDate.getMonth() + 1}/${startDate.getDate()}（${weekdays[startDate.getDay()]}）〜${endDate.getMonth() + 1}/${endDate.getDate()}（${weekdays[endDate.getDay()]}）`;
}

async function openSetWorkbenchWithRealData(page: Page, path: string) {
  await page.addInitScript(() => {
    window.localStorage.removeItem('chouzai-workbench');
  });

  await openStableRoute(page, path);

  const patientsResponse = await page.request.get('/api/dispense-workbench/patients');
  expect(patientsResponse.ok()).toBe(true);
  const patients = (await patientsResponse.json()) as WorkbenchPatientsPayload;
  expect(patients.data.length).toBeGreaterThan(0);

  const fallbackPlan = patients.data.find((row) => row.latest_set_plan_id);
  const planId = SET_AUDIT_SUCCESS_PLAN_ID || fallbackPlan?.latest_set_plan_id;
  expect(planId).toBeTruthy();

  const calendarResponse = await page.request.get(`/api/set-plans/${planId}/calendar`);
  expect(calendarResponse.ok()).toBe(true);

  const calendar = (await calendarResponse.json()) as SetCalendarPayload;
  expect(calendar.data.plan_id).toBe(planId);
  expect(calendar.data.rows.length).toBeGreaterThan(0);
  expect(calendar.data.day_count).toBeGreaterThan(0);

  return {
    planId: calendar.data.plan_id,
    cycleId: calendar.data.cycle_id,
    drugName: calendar.data.rows[0].line.drug_name,
    periodLabel: formatSetCalendarPeriod(calendar.data.period_start, calendar.data.day_count),
  };
}

async function waitForSetAuditApprovalReady(main: Locator) {
  await expect(main).toContainText('✓ 全セル監査OK（承認可）', { timeout: 15_000 });
  await expect(main.getByRole('button', { name: '監査承認（薬剤師）✓' })).toBeEnabled({
    timeout: 15_000,
  });
}

async function waitForVisibleSetAuditCell(main: Locator) {
  const cell = main.locator('[role="button"]').filter({ hasText: /包/ }).first();
  await expect(cell).toBeVisible({ timeout: 15_000 });
  return cell;
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
            FROM "AuditLog" log
            JOIN "SetAudit" audit ON audit.id = log.target_id
            JOIN target_plan plan ON plan.id = audit.plan_id AND plan.org_id = audit.org_id
            WHERE log.action = 'set_audit.create'
          ) AS create_audit_logs,
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
    await expect(main).toBeVisible();
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
    await clickAndWaitForStableRoute(
      page,
      /\/prescriptions\/new/,
      () => main.getByRole('link', { name: '新規受付' }).first().click({ noWaitAfter: true }),
      { timeout: 45_000 },
    );

    await expect(page.getByRole('heading', { name: '新規処方受付' })).toBeVisible({
      timeout: 45_000,
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
    await clickAndWaitForStableRoute(
      page,
      /\/dispense/,
      () => main.getByRole('link', { name: '調剤キュー' }).first().click({ noWaitAfter: true }),
      { timeout: 45_000 },
    );

    // 新 DispensingWorkbench の工程タブが安定アンカー（旧「調剤」見出しは撤去済み）。
    await expect(main.getByRole('navigation', { name: '工程タブ' })).toBeVisible({
      timeout: 45_000,
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

  test('dispense → audit navigation works', async ({ context }) => {
    test.slow();
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/dispense');

    const main = page.locator('main');
    // 新ワークベンチは工程タブ（調剤監査 → /audit）の <Link> で遷移する。
    await clickAndWaitForStableRoute(
      page,
      /\/audit/,
      () =>
        main
          .getByRole('link', { name: '調剤監査', exact: true })
          .first()
          .click({ noWaitAfter: true }),
      { timeout: 45_000 },
    );

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
    ).toBeVisible();

    // → dispense（/prescriptions 側の「調剤キュー」ショートカットは維持）
    await clickAndWaitForStableRoute(page, /\/dispense/, () =>
      page.locator('main').getByRole('link', { name: '調剤キュー' }).first().click(),
    );
    const main = page.locator('main');
    await expect(main.getByRole('navigation', { name: '工程タブ' })).toBeVisible();

    // → audit via 工程タブ（調剤監査 → /audit）
    await clickAndWaitForStableRoute(
      page,
      /\/audit/,
      () =>
        main.getByRole('link', { name: '調剤監査', exact: true }).first().click({
          noWaitAfter: true,
        }),
      { timeout: 90_000 },
    );
    await expect(main.locator('a[aria-current="page"]')).toBeVisible();

    // → back to dispense via 工程タブ（調剤 → /dispense）
    await clickAndWaitForStableRoute(page, /\/dispense/, () =>
      main.getByRole('link', { name: '調剤', exact: true }).first().click(),
    );
    await expect(main.getByRole('navigation', { name: '工程タブ' })).toBeVisible();

    expect(errors).toEqual([]);
  });
});

test.describe('set → set-audit real-data direct entry', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
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

    await main.locator('[role="button"]').filter({ hasText: /包/ }).first().click();
    await expect(ngClassification).toBeEnabled();
    await ngClassification.selectOption({ label: '数量不足' });
    await expect(rejectButton).toBeEnabled();

    expect(errors).toEqual([]);
  });

  test('set-audit final approval stays on set-audit when the API returns a conflict', async ({
    context,
  }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openSetWorkbenchWithRealData(page, '/set-audit');

    const main = page.locator('main');
    await waitForVisibleSetAuditCell(main);
    await main.getByRole('button', { name: '全セルOK' }).click();
    await (await waitForVisibleSetAuditCell(main)).click();
    for (const label of [
      '日付が正しい',
      '用法が正しい',
      '数量が正しい',
      '中止薬が混入していない',
      '残薬使用の指示と一致',
      '冷所薬を分離している',
    ]) {
      await main.getByRole('button', { name: label }).click();
    }
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
      result: 'approved',
      checklist: {
        date_match: true,
        timing_match: true,
        quantity_match: true,
        no_discontinued: true,
        residual_usage_ok: true,
        cold_storage_separated: true,
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
  }) => {
    test.slow();
    await resetSetAuditSuccessFixture();

    const { page, errors } = await createInstrumentedPage(context);
    const data = await openSetWorkbenchWithRealData(page, '/set-audit');
    expect(data.planId).toBe(SET_AUDIT_SUCCESS_PLAN_ID);

    const main = page.locator('main');
    await waitForVisibleSetAuditCell(main);
    await main.getByRole('button', { name: '全セルOK' }).click();
    await (await waitForVisibleSetAuditCell(main)).click();
    for (const label of [
      '日付が正しい',
      '用法が正しい',
      '数量が正しい',
      '中止薬が混入していない',
      '残薬使用の指示と一致',
      '冷所薬を分離している',
    ]) {
      await main.getByRole('button', { name: label }).click();
    }
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
    expect(state.create_audit_logs).toBeGreaterThanOrEqual(1);
    expect(state.cell_audit_logs).toBeGreaterThanOrEqual(state.set_batches);

    expect(errors).toEqual([]);
  });
});
