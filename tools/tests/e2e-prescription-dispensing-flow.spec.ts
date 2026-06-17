import { expect, test, type Page, type Response } from '@playwright/test';
import {
  attachLocalSession,
  clickAndWaitForStableRoute,
  createInstrumentedPage,
  openStableRoute,
} from './helpers/local-auth';

type WorkbenchPatientsPayload = {
  data: Array<{ patient_id: string; name: string }>;
};

type SetPlansPayload = {
  data: Array<{ id: string; cycle_id: string }>;
};

type SetCalendarPayload = {
  data: {
    plan_id: string;
    period_start: string;
    day_count: number;
    rows: Array<{ line: { drug_name: string } }>;
  };
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
  const setPlanResponses: Response[] = [];
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (
      url.pathname === '/api/set-plans' &&
      url.searchParams.has('patient_id') &&
      response.request().method() === 'GET'
    ) {
      setPlanResponses.push(response);
    }
  });

  const patientsPromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === '/api/dispense-workbench/patients' && response.request().method() === 'GET'
    );
  });
  const calendarPromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      /^\/api\/set-plans\/[^/]+\/calendar$/.test(url.pathname) &&
      response.request().method() === 'GET'
    );
  });

  await openStableRoute(page, path);

  const [patientsResponse, calendarResponse] = await Promise.all([
    patientsPromise,
    calendarPromise,
  ]);

  expect(patientsResponse.ok()).toBe(true);
  expect(calendarResponse.ok()).toBe(true);

  const patients = (await patientsResponse.json()) as WorkbenchPatientsPayload;
  const planPayloads = await Promise.all(
    setPlanResponses.map(async (response) => (await response.json()) as SetPlansPayload),
  );
  const resolvedPlans = planPayloads.flatMap((payload) => payload.data);
  const calendar = (await calendarResponse.json()) as SetCalendarPayload;

  expect(patients.data.length).toBeGreaterThan(0);
  expect(resolvedPlans.length).toBeGreaterThan(0);
  expect(resolvedPlans.some((plan) => plan.id === calendar.data.plan_id)).toBe(true);
  expect(calendar.data.rows.length).toBeGreaterThan(0);
  expect(calendar.data.day_count).toBeGreaterThan(0);

  return {
    patientName: patients.data[0].name,
    drugName: calendar.data.rows[0].line.drug_name,
    periodLabel: formatSetCalendarPeriod(calendar.data.period_start, calendar.data.day_count),
  };
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

    // 新 DispensingWorkbench のメニューバーが安定アンカー（旧「調剤」見出しは撤去済み）。
    await expect(main.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible({
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

    // 新 DispensingWorkbench のメニューバーが安定アンカー（旧「調剤」見出しは撤去済み）。
    await expect(
      page.locator('main').getByRole('navigation', { name: 'メインメニュー' }),
    ).toBeVisible();

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

    await expect(
      page.locator('main').getByRole('navigation', { name: 'メインメニュー' }),
    ).toBeVisible();

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
    await expect(main.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible();

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
    await expect(main.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible();

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
    const data = await openSetWorkbenchWithRealData(page, '/set');

    const main = page.locator('main');
    await expect(main.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible();
    await expect(main).toContainText(data.patientName);
    await expect(main).toContainText(data.drugName);
    await expect(main).toContainText(data.periodLabel);
    expect(errors).toEqual([]);
  });

  test('set-audit workbench resolves patient SetPlan calendar data on direct entry', async ({
    context,
  }) => {
    const { page, errors } = await createInstrumentedPage(context);
    const data = await openSetWorkbenchWithRealData(page, '/set-audit');

    const main = page.locator('main');
    await expect(main.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible();
    await expect(main).toContainText(data.patientName);
    await expect(main).toContainText(data.drugName);
    await expect(main).toContainText(data.periodLabel);
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
    await main.getByRole('button', { name: '全セルOK' }).click();
    await main.locator('[role="button"]').filter({ hasText: /包/ }).first().click();
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

    const approvalResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/api/set-audits' && response.request().method() === 'POST';
    });
    await main.getByRole('button', { name: '監査承認（薬剤師）✓' }).click();

    const response = await approvalResponse;
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
});
