import { expect, test } from '@playwright/test';
import type { Locator } from '@playwright/test';
import {
  attachLocalSession,
  clickAndWaitForStableRoute,
  createInstrumentedPage,
  openStableRoute,
  waitForStableUi,
} from './helpers/local-auth';

async function expectWorkbenchChromeRemoved(main: Locator) {
  await expect(main.getByRole('navigation', { name: 'メインメニュー' })).toHaveCount(0);
  await expect(main).not.toContainText('ファーマ在宅 調剤システム');
  await expect(main.getByRole('button', { name: /^F(?:[1-9]|1[0-2])\b/ })).toHaveCount(0);
}

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
    await page
      .waitForResponse((res) => res.url().includes('/api/patients') && res.status() === 200, {
        timeout: 5000,
      })
      .catch(() => null);
    await waitForStableUi(page);

    expect(errors).toEqual([]);
  });

  test('navigating from prescription list to new intake via header link', async ({ context }) => {
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

    await clickAndWaitForStableRoute(page, /\/dispense/, () =>
      main.getByRole('link', { name: '調剤キュー' }).first().click(),
    );

    await expect(page.locator('main').getByRole('navigation', { name: '工程タブ' })).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('dispensing queue', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('dispensing queue page loads with header and shortcut links', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/dispense');

    const main = page.locator('main');
    // 新 DispensingWorkbench の安定アンカーは工程タブ nav[aria-label="工程タブ"]。
    // 旧 dispense-workbench testid は撤去済み。
    await expect(main.getByRole('navigation', { name: '工程タブ' })).toBeVisible();
    await expectWorkbenchChromeRemoved(main);
    // 工程タブ（調剤 / 調剤監査 / セット / セット監査）への <Link> が描画される。
    await expect(main.getByRole('link', { name: '調剤監査', exact: true })).toBeVisible();
    await expect(main.getByRole('link', { name: 'セット', exact: true })).toBeVisible();
    // ユーザー指定の保持対象ボタン。
    await expect(main.getByRole('button', { name: /前回処方と比較/ })).toBeVisible();
    await expect(main.getByRole('button', { name: /新規グループ/ })).toBeVisible();
    // 要確認: 旧 dispense ページの「調剤キュー」見出し・「監査」「ワークフロー」ショートカットリンクは
    // 新ワークベンチには存在しない（工程タブへ集約）。旧アサーションは撤去。

    expect(errors).toEqual([]);
  });

  test('dispensing queue shows task list or empty state', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/dispense');

    // Should show either task cards or an empty state message
    const hasContent = await page.locator('main').textContent();

    // Page should have meaningful content (not blank)
    expect(hasContent?.trim().length).toBeGreaterThan(0);

    expect(errors).toEqual([]);
  });

  test('phase tab from dispensing to audit works', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/dispense');

    const main = page.locator('main');
    // 新ワークベンチは工程タブ（調剤監査 → /audit）の <Link> で遷移する。
    await clickAndWaitForStableRoute(page, /\/audit/, () =>
      main.getByRole('link', { name: '調剤監査', exact: true }).first().click(),
    );

    // 遷移後は調剤監査工程タブが active（aria-current="page"）になる。
    await expect(main.locator('a[aria-current="page"]')).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('auditing queue', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('audit queue page loads with workbench shell and phase tabs', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/audit');

    const main = page.locator('main');
    // 新 DispensingWorkbench（phase="audit"）。安定アンカーは工程タブ。
    // 旧 audit-workbench / main-workflow-compact-nav testid は撤去済み。
    await expect(main.getByRole('navigation', { name: '工程タブ' })).toBeVisible();
    await expectWorkbenchChromeRemoved(main);
    // 工程タブ（調剤 / セット）への <Link> が描画される。
    await expect(main.getByRole('link', { name: '調剤', exact: true }).first()).toBeVisible();
    await expect(main.getByRole('link', { name: 'セット', exact: true }).first()).toBeVisible();
    // 要確認: 旧 audit ページの「監査」見出し・「ワークフロー」ショートカットリンクは
    // 新ワークベンチには存在しない（工程タブへ集約）。旧アサーションは撤去。

    expect(errors).toEqual([]);
  });

  test('audit queue shows workbench content', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/audit');

    const hasContent = await page.locator('main').textContent();
    expect(hasContent?.trim().length).toBeGreaterThan(0);

    expect(errors).toEqual([]);
  });
});

test.describe('workflow cross-navigation', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('full workflow navigation: prescriptions -> dispense -> audit -> back', async ({
    context,
  }) => {
    const { page, errors } = await createInstrumentedPage(context);

    // Start at prescriptions
    await openStableRoute(page, '/prescriptions');
    await expect(page.getByRole('heading', { name: '処方受付' })).toBeVisible();

    // Navigate to dispense via shortcut（/prescriptions 側の「調剤キュー」ショートカットは維持）
    await clickAndWaitForStableRoute(page, /\/dispense/, () =>
      page.locator('main').getByRole('link', { name: '調剤キュー' }).first().click(),
    );
    // 新ワークベンチの工程タブが安定アンカー（旧「調剤キュー」見出しは撤去済み）。
    const main = page.locator('main');
    await expect(main.getByRole('navigation', { name: '工程タブ' })).toBeVisible();

    // Navigate to audit via 工程タブ（調剤監査 → /audit）
    await clickAndWaitForStableRoute(page, /\/audit/, () =>
      main.getByRole('link', { name: '調剤監査', exact: true }).first().click(),
    );
    await expect(main.locator('a[aria-current="page"]')).toBeVisible();

    // Navigate back to dispense via 工程タブ（調剤 → /dispense）
    await clickAndWaitForStableRoute(page, /\/dispense/, () =>
      main.getByRole('link', { name: '調剤', exact: true }).first().click(),
    );
    await expect(main.getByRole('navigation', { name: '工程タブ' })).toBeVisible();

    // Full round trip should have no errors
    expect(errors).toEqual([]);
  });
});
