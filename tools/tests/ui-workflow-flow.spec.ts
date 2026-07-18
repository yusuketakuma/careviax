import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import {
  attachLocalSession,
  clickAndWaitForStableRoute,
  createInstrumentedPage,
  openStableRoute,
} from './helpers/local-auth';

async function expectWorkbenchChromeRemoved(main: Locator) {
  await expect(main.getByRole('navigation', { name: 'メインメニュー' })).toHaveCount(0);
  await expect(main).not.toContainText('ファーマ在宅 調剤システム');
  await expect(main.getByRole('button', { name: /^F(?:[1-9]|1[0-2])\b/ })).toHaveCount(0);
}

async function fetchFirstPatientOption(page: Page) {
  const response = await page.request.get('/api/patients?limit=5&sort=name_kana&order=asc');
  expect(response.ok()).toBeTruthy();

  const payload = (await response.json()) as {
    data?: Array<{ id?: unknown; name?: unknown; name_kana?: unknown }>;
  };
  const patient = payload.data?.find(
    (item) =>
      typeof item.id === 'string' &&
      item.id.length > 0 &&
      typeof item.name === 'string' &&
      item.name.length > 0,
  );
  expect(patient).toBeTruthy();

  return patient as { id: string; name: string; name_kana?: string };
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

    // This workflow test verifies the prescription form's patient_id URL contract.
    // Patient-list rendering itself is covered by ui-patient-flow.spec.ts, so avoid
    // coupling this path to /patients card hydration.
    const patient = await fetchFirstPatientOption(page);

    // Navigate to prescription intake with patient_id param
    const selectedPatientResponse = page
      .waitForResponse(
        (res) => {
          const url = new URL(res.url());
          return url.pathname === `/api/patients/${patient.id}` && res.status() === 200;
        },
        { timeout: 30_000 },
      )
      .catch(() => null);
    await openStableRoute(page, `/prescriptions/new?patient_id=${patient.id}`);
    await selectedPatientResponse;

    await expect(page.getByRole('heading', { name: '新規処方受付' })).toBeVisible();

    await expect(page.getByLabel('患者検索')).toHaveValue(new RegExp(patient.name), {
      timeout: 30_000,
    });

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

    await expect(
      page.locator('main').getByRole('navigation', { name: '現在の工程' }),
    ).toBeVisible();
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
    // 新 DispensingWorkbench の安定アンカーは静的工程ヘッダ nav[aria-label="現在の工程"]。
    // 旧クリック可能な工程タブ（nav[aria-label="工程タブ"]）は撤去済み。工程切替は左メニュー。
    const phaseHeader = main.getByRole('navigation', { name: '現在の工程' });
    await expect(phaseHeader).toBeVisible();
    await expectWorkbenchChromeRemoved(main);
    // 静的ヘッダは現工程（調剤）のみを aria-current="page" の span で表示する。
    // 他工程へのクリック可能なタブ <Link> は存在しない（左メニューへ集約）。
    await expect(phaseHeader.locator('[aria-current="page"]')).toContainText('調剤');
    // ユーザー指定の保持対象ボタン。
    await expect(main.getByRole('button', { name: /前回処方と比較/ })).toBeVisible();
    await expect(main.getByRole('button', { name: /新規グループ/ })).toBeVisible();
    // 要確認: 旧 dispense ページの「調剤キュー」見出し・「監査」「ワークフロー」ショートカットリンクは
    // 新ワークベンチには存在しない。旧アサーションは撤去。

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

  test('phase navigation from dispensing to audit works via left menu', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/dispense');

    const main = page.locator('main');
    await expect(main.getByRole('navigation', { name: '現在の工程' })).toBeVisible();
    // 工程切替は左メニュー（href ベース。'監査' は critical バッジを持つためラベル一致を避ける）。
    await clickAndWaitForStableRoute(page, /\/audit/, () =>
      page.locator('a[href="/audit"]').first().click(),
    );

    // 遷移後は監査画面の静的工程ヘッダが現工程（調剤監査）を表示する。
    const phaseHeader = main.getByRole('navigation', { name: '現在の工程' });
    await expect(phaseHeader).toBeVisible();
    await expect(phaseHeader.locator('[aria-current="page"]')).toContainText('調剤監査');
    expect(errors).toEqual([]);
  });
});

test.describe('auditing queue', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('audit queue page loads with workbench shell and static phase header', async ({
    context,
  }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/audit');

    const main = page.locator('main');
    // 新 DispensingWorkbench（phase="audit"）。安定アンカーは静的工程ヘッダ。
    // 旧クリック可能な工程タブ（nav[aria-label="工程タブ"]）は撤去済み。工程切替は左メニュー。
    const phaseHeader = main.getByRole('navigation', { name: '現在の工程' });
    await expect(phaseHeader).toBeVisible();
    await expectWorkbenchChromeRemoved(main);
    // 静的ヘッダは現工程（調剤監査）のみを aria-current="page" の span で表示する。
    // 他工程へのクリック可能なタブ <Link> は存在しない（左メニューへ集約）。
    await expect(phaseHeader.locator('[aria-current="page"]')).toContainText('調剤監査');

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
    // 新ワークベンチの静的工程ヘッダが安定アンカー（旧「調剤キュー」見出しは撤去済み）。
    const main = page.locator('main');
    const phaseHeader = main.getByRole('navigation', { name: '現在の工程' });
    await expect(phaseHeader).toBeVisible();

    // Navigate to audit via 左メニュー（href ベース。'監査' は critical バッジを持つ）
    await clickAndWaitForStableRoute(page, /\/audit/, () =>
      page.locator('a[href="/audit"]').first().click(),
    );
    await expect(phaseHeader).toBeVisible();
    await expect(phaseHeader.locator('[aria-current="page"]')).toContainText('調剤監査');

    // Navigate back to dispense via 左メニュー（調剤 → /dispense）
    await clickAndWaitForStableRoute(page, /\/dispense/, () =>
      page.locator('a[href="/dispense"]').first().click(),
    );
    await expect(phaseHeader).toBeVisible();
    await expect(phaseHeader.locator('[aria-current="page"]')).toContainText('調剤');

    // Full round trip should have no errors
    expect(errors).toEqual([]);
  });
});
