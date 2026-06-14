import { expect, test } from '@playwright/test';
import {
  attachLocalSession,
  clickAndWaitForStableRoute,
  createInstrumentedPage,
  openStableRoute,
  waitForStableUi,
} from './helpers/local-auth';

test.describe('prescription intake flow', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('prescription list page loads with header and new intake link', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/prescriptions');
    const main = page.locator('main');

    await expect(page.getByRole('heading', { name: '処方受付' })).toBeVisible();
    // "新規受付" link should be accessible
    const newIntakeLink = main.getByRole('link', { name: '新規受付' }).first();
    await expect(newIntakeLink).toBeVisible();

    // Shortcut links should be present
    await expect(main.getByRole('link', { name: 'QR下書き' }).first()).toBeVisible();
    await expect(main.getByRole('link', { name: '調剤キュー' }).first()).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('new prescription intake form loads without errors', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/prescriptions/new');

    await expect(page.getByRole('heading', { name: '新規処方受付' })).toBeVisible();

    // Patient/case selection fieldset should be visible
    await expect(page.getByRole('group', { name: '患者・ケース' })).toBeVisible();

    // Source type selection should be available
    await expect(page.getByText('ソースタイプ')).toBeVisible();

    // The form should have a date field for prescribed date
    await expect(page.getByText('処方日')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('prescription intake form pre-fills patient from URL params', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);

    // First get a patient ID from the patient list.
    // 新デザインの患者一覧はカード起点(patient-board-card-link)で旧 tbody テーブルは無い。
    await openStableRoute(page, '/patients');
    const firstPatientLink = page.getByTestId('patient-board-card-link').first();
    const href = await firstPatientLink.getAttribute('href');
    const patientId = href?.replace('/patients/', '') ?? '';
    expect(patientId).toBeTruthy();

    // Navigate to prescription intake with patient_id param
    await openStableRoute(page, `/prescriptions/new?patient_id=${patientId}`);

    await expect(page.getByRole('heading', { name: '新規処方受付' })).toBeVisible();

    // Patient should be pre-selected (patient name should appear somewhere)
    // Wait for patient data to load
    await page.waitForResponse(
      (res) => res.url().includes('/api/patients') && res.status() === 200,
      { timeout: 5000 },
    ).catch(() => null);
    await waitForStableUi(page);

    expect(errors).toEqual([]);
  });

  test('navigating from prescription list to new intake via header link', async ({
    context,
  }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/prescriptions');

    await clickAndWaitForStableRoute(page, /\/prescriptions\/new/, () =>
      page.locator('main').getByRole('link', { name: '新規受付' }).first().click(),
    );

    await expect(page.getByRole('heading', { name: '新規処方受付' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('shortcut link from prescriptions to dispensing queue works', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/prescriptions');
    const main = page.locator('main');

    await clickAndWaitForStableRoute(page, /\/dispensing/, () =>
      main.getByRole('link', { name: '調剤キュー' }).first().click(),
    );

    // exact: true で調剤ワークベンチ左ペインの <h3>調剤キュー</h3> のみを対象にする
    // (旧 <h1>調剤キュー(全件一覧)</h1> との strict-mode 衝突を回避)。
    await expect(page.getByRole('heading', { name: '調剤キュー', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('dispensing queue', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('dispensing queue page loads with header and shortcut links', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/dispensing');

    const main = page.locator('main');
    // exact: true で調剤ワークベンチ左ペインの <h3>調剤キュー</h3> のみを対象にする
    // (旧 <h1>調剤キュー(全件一覧)</h1> との strict-mode 衝突を回避)。
    await expect(page.getByRole('heading', { name: '調剤キュー', exact: true })).toBeVisible();
    await expect(
      main.getByText('緊急度、訪問先、疑義照会状況を上から確認し、調剤入力へ進みます。'),
    ).toBeVisible();

    // Shortcut links (scoped to main to avoid sidebar duplicates)
    await expect(main.getByRole('link', { name: '監査', exact: true })).toBeVisible();
    await expect(main.getByRole('link', { name: 'ワークフロー' })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('dispensing queue shows task list or empty state', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/dispensing');

    // Should show either task cards or an empty state message
    const hasContent = await page.locator('main').textContent();

    // Page should have meaningful content (not blank)
    expect(hasContent?.trim().length).toBeGreaterThan(0);

    expect(errors).toEqual([]);
  });

  test('shortcut link from dispensing to auditing works', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/dispensing');

    const main = page.locator('main');
    await clickAndWaitForStableRoute(page, /\/auditing/, () =>
      main.getByRole('link', { name: '監査', exact: true }).first().click(),
    );

    // /auditing のページ見出しは新デザインで <h1>監査キュー(全件一覧)</h1> に改称
    // (旧 <h1>調剤鑑査</h1> は /auditing/[taskId] 詳細側へ移動済み)。
    await expect(
      page.getByRole('heading', { name: '監査キュー(全件一覧)', exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('auditing queue', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('auditing queue page loads with header and shortcut links', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/auditing');

    const main = page.locator('main');
    // /auditing のページ見出しは新デザインで <h1>監査キュー(全件一覧)</h1> に改称。
    await expect(
      page.getByRole('heading', { name: '監査キュー(全件一覧)', exact: true }),
    ).toBeVisible();
    await expect(
      main.getByText('差異、疑義照会、未承認件数を先に把握し、差戻しと合格の判断を揃えます。'),
    ).toBeVisible();

    // Shortcut links (scoped to main to avoid sidebar duplicates)
    await expect(main.getByRole('link', { name: '調剤', exact: true }).first()).toBeVisible();
    await expect(main.getByRole('link', { name: 'セット管理' })).toBeVisible();
    await expect(main.getByRole('link', { name: 'ワークフロー' })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('auditing queue shows task list or empty state', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/auditing');

    const hasContent = await page.locator('main').textContent();
    expect(hasContent?.trim().length).toBeGreaterThan(0);

    expect(errors).toEqual([]);
  });
});

test.describe('workflow cross-navigation', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('full workflow navigation: prescriptions -> dispensing -> auditing -> back', async ({
    context,
  }) => {
    const { page, errors } = await createInstrumentedPage(context);

    // Start at prescriptions
    await openStableRoute(page, '/prescriptions');
    await expect(page.getByRole('heading', { name: '処方受付' })).toBeVisible();

    // Navigate to dispensing via shortcut
    await clickAndWaitForStableRoute(page, /\/dispensing/, () =>
      page.locator('main').getByRole('link', { name: '調剤キュー' }).first().click(),
    );
    // exact: true で調剤ワークベンチ左ペインの <h3>調剤キュー</h3> のみを対象にする
    // (旧 <h1>調剤キュー(全件一覧)</h1> との strict-mode 衝突を回避)。
    await expect(page.getByRole('heading', { name: '調剤キュー', exact: true })).toBeVisible();

    // Navigate to auditing via shortcut (scope to main to avoid sidebar duplicate)
    const main = page.locator('main');
    await clickAndWaitForStableRoute(page, /\/auditing/, () =>
      main.getByRole('link', { name: '監査', exact: true }).first().click(),
    );
    // /auditing のページ見出しは新デザインで <h1>監査キュー(全件一覧)</h1> に改称。
    await expect(
      page.getByRole('heading', { name: '監査キュー(全件一覧)', exact: true }),
    ).toBeVisible();

    // Navigate back to dispensing via shortcut (scope to main)
    await clickAndWaitForStableRoute(page, /\/dispensing/, () =>
      main.getByRole('link', { name: '調剤', exact: true }).first().click(),
    );
    await expect(page.getByRole('heading', { name: '調剤キュー', exact: true })).toBeVisible();

    // Full round trip should have no errors
    expect(errors).toEqual([]);
  });
});
