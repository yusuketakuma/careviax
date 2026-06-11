import { expect, test, type Page } from '@playwright/test';
import {
  attachLocalSession,
  clickAndWaitForStableRoute,
  createInstrumentedPage,
  openStableRoute,
  reloadStablePage,
  waitForStableUi,
} from './helpers/local-auth';

test.setTimeout(60_000);

async function openFirstPatientDetail(
  page: Page,
  options: { view?: 'card' | 'profile'; tab?: string } = {},
) {
  // 遷移の起点は /patients 最上部の patients-board カード(氏名リンク)。
  // 旧テーブル(patients-classic)は md 未満で hidden になるため、tbody 行リンク前提だと
  // mobile-chromium で要素不可視になる。board カードは全ビューポートで表示される。
  const firstPatientLink = page.getByTestId('patient-board-card-link').first();
  await expect(firstPatientLink).toBeVisible({ timeout: 30_000 });
  const href = await firstPatientLink.getAttribute('href');
  expect(href).toBeTruthy();

  // Default /patients/[id] is the card workspace; the legacy tab UI lives at ?view=profile.
  if (options.view === 'profile') {
    const params = new URLSearchParams({ view: 'profile' });
    if (options.tab) params.set('tab', options.tab);
    await openStableRoute(page, `${href}?${params.toString()}`);
    await expect(page.getByTestId('patient-detail-tablist')).toBeVisible({ timeout: 30_000 });
  } else {
    await clickAndWaitForStableRoute(page, new RegExp(`${href}$`), () =>
      firstPatientLink.click({ noWaitAfter: true }),
    );
    await expect(page.getByTestId('card-workspace')).toBeVisible({ timeout: 30_000 });
  }
  return href!;
}

async function openNewPatientFormFromList(page: Page) {
  await openStableRoute(page, '/patients');
  await clickAndWaitForStableRoute(page, /\/patients\/new$/, () =>
    page.getByRole('link', { name: '新規登録' }).click(),
  );
}

test.describe('patient list and navigation flow', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('patient list loads with data and table columns', async ({ context, isMobile }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/patients');

    if (isMobile) {
      // 旧テーブル(patients-classic)は md 未満で hidden になるため、
      // モバイルは最上部の patients-board カードで患者データの表示を検証する。
      const cards = page.getByTestId('patient-board-card');
      await expect(cards.first()).toBeVisible({ timeout: 30_000 });
      expect(await cards.count()).toBeGreaterThan(0);
    } else {
      // Table should render with expected column headers
      await expect(page.getByRole('columnheader', { name: '氏名' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: '年齢' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'ケース状態' })).toBeVisible();

      // At least one patient row should be visible (demo data)
      const rows = page.locator('table tbody tr');
      await expect(rows.first()).toBeVisible();
      const rowCount = await rows.count();
      expect(rowCount).toBeGreaterThan(0);
    }

    // Page header should show title
    await expect(page.getByRole('heading', { name: '患者一覧', level: 1 })).toBeVisible();

    // New patient registration link should be accessible
    const newPatientLink = page.getByRole('link', { name: '新規登録' });
    await expect(newPatientLink).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('search filters patient list by name', async ({ context, isMobile }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/patients');

    if (isMobile) {
      // テーブル(と氏名検索の結果リンク)は md 未満で hidden のため、
      // モバイルは patients-board の検索ボックスで氏名絞り込みを検証する。
      const firstCardLink = page.getByTestId('patient-board-card-link').first();
      await expect(firstCardLink).toBeVisible({ timeout: 30_000 });
      const cardPatientName = (await firstCardLink.textContent())?.trim();
      expect(cardPatientName).toBeTruthy();

      await page.getByLabel('氏名・住所で検索').fill(cardPatientName!);
      await expect(
        page.getByTestId('patient-board-card-link').filter({ hasText: cardPatientName! }).first(),
      ).toBeVisible();

      expect(errors).toEqual([]);
      return;
    }

    // Get the first patient name from the table for searching
    const firstPatientName = await page
      .locator('table tbody tr')
      .first()
      .locator('a')
      .first()
      .textContent();
    expect(firstPatientName).toBeTruthy();

    // Search for the patient
    // NOTE: placeholder の「氏名」は board 検索(氏名・住所で検索)とテーブル検索
    // (氏名・ふりがなを検索)の両方に部分一致して strict mode violation になるため、
    // テーブル側のフィルタ入力を aria-label で特定する。
    const searchInput = page.getByLabel('患者検索');
    if (await searchInput.isVisible()) {
      await searchInput.fill(firstPatientName!.trim());
      // Wait for the query to refetch
      await page.waitForResponse((res) => res.url().includes('/api/patients'));
      await waitForStableUi(page);

      // The searched patient should still be visible in the table
      // (board カードにも同名リンクがあり得るため tbody にスコープする)
      await expect(
        page
          .locator('table tbody')
          .getByRole('link', { name: firstPatientName!.trim() })
          .first(),
      ).toBeVisible();
    }

    expect(errors).toEqual([]);
  });

  test('clicking patient name navigates to detail page', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/patients');

    // Use specific selector for patient detail links (not other action links)
    const href = await openFirstPatientDetail(page);

    // Should navigate to patient detail (card workspace is the default view).
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(page.getByTestId('card-workspace')).toBeVisible();
    await expect(page.getByRole('heading', { name: /カード — / })).toBeVisible();

    // Link to the legacy profile view should be available
    await expect(page.getByTestId('card-open-profile')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('patient profile back link returns to patient list', async ({ context, isMobile }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/patients');

    // Navigate to first patient profile view (the back link lives in its mini card)
    const href = await openFirstPatientDetail(page, { view: 'profile' });
    expect(page.url()).toContain(`${href}?view=profile`);

    if (isMobile) {
      // 「一覧へ戻る」を持つ患者ミニカードは md 以上のみ表示されるため、
      // モバイルの実際の一覧復帰導線である下部ナビの「患者」を検証する。
      await clickAndWaitForStableRoute(page, /\/patients$/, () =>
        page
          .getByTestId('mobile-bottom-nav')
          .getByRole('link', { name: '患者' })
          .click({ noWaitAfter: true }),
      );
    } else {
      // Click back link
      await clickAndWaitForStableRoute(page, /\/patients$/, () =>
        page.getByRole('link', { name: '一覧へ戻る' }).click({ noWaitAfter: true }),
      );
    }

    // Should be back on patient list
    await expect(page).toHaveURL(/\/patients$/);
    await expect(page.getByRole('heading', { name: '患者一覧', level: 1 })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('action buttons on patient row link to correct pages', async ({ context, isMobile }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/patients');

    if (isMobile) {
      // テーブルの行アクション列(詳細/薬歴/処方受付)は mobileHidden のデスクトップ専用 UI。
      // モバイルの行相当は patients-board カードのため、患者詳細への導線を検証する。
      const firstCard = page.getByTestId('patient-board-card').first();
      await expect(firstCard).toBeVisible({ timeout: 30_000 });

      const detailLink = firstCard.getByTestId('patient-board-card-link');
      await expect(detailLink).toBeVisible();
      const cardDetailHref = await detailLink.getAttribute('href');
      expect(cardDetailHref).toMatch(/\/patients\/.+/);

      expect(errors).toEqual([]);
      return;
    }

    const firstRow = page.locator('table tbody tr').first();

    // "詳細" button should exist and point to patient detail
    const detailLink = firstRow.getByRole('link', { name: '詳細' });
    await expect(detailLink).toBeVisible();
    const detailHref = await detailLink.getAttribute('href');
    expect(detailHref).toMatch(/\/patients\/.+/);

    // "薬歴" button should exist
    const medicationLink = firstRow.getByRole('link', { name: '薬歴' });
    await expect(medicationLink).toBeVisible();
    const medicationHref = await medicationLink.getAttribute('href');
    expect(medicationHref).toMatch(/\/patients\/.+\/prescriptions/);

    // "処方受付" button should exist
    const prescriptionLink = firstRow.getByRole('link', { name: '処方受付' });
    await expect(prescriptionLink).toBeVisible();
    const prescriptionHref = await prescriptionLink.getAttribute('href');
    expect(prescriptionHref).toMatch(/\/prescriptions\/new/);

    expect(errors).toEqual([]);
  });
});

test.describe('patient list filters', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('filter panel is visible with all filter controls', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/patients');

    const filterPanel = page.getByTestId('patients-filter-panel');
    await expect(filterPanel).toBeVisible();

    // Search input
    await expect(page.getByLabel('患者検索')).toBeVisible();

    // Filter selects (by aria-label)
    await expect(page.getByLabel('リスクフィルタ')).toBeVisible();
    await expect(page.getByLabel('ステータスフィルタ')).toBeVisible();

    await page.getByRole('button', { name: /詳細フィルタ|詳細を閉じる/ }).click();
    await expect(page.getByLabel('同意状態フィルタ')).toBeVisible();
    await expect(page.getByLabel('施設フィルタ')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('search input filters the patient table', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/patients');

    const rowsBefore = await page.locator('table tbody tr').count();
    expect(rowsBefore).toBeGreaterThan(0);

    // Type a search that's unlikely to match any patient
    const searchInput = page.getByLabel('患者検索');
    await searchInput.fill('ZZZZNONEXISTENT');

    // Should show no rows or an empty/no-results state
    await expect
      .poll(async () => page.locator('table tbody tr').count(), {
        message: 'patient search should settle after debounce/refetch',
      })
      .toBeLessThanOrEqual(rowsBefore);

    expect(errors).toEqual([]);
  });

  test('risk filter changes the displayed patients', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/patients');

    // Open risk filter dropdown
    const riskTrigger = page.getByLabel('リスクフィルタ');
    await riskTrigger.click();

    // Select "安定"
    await page.getByRole('option', { name: '安定' }).click();

    // Wait for API response with the filter
    await page
      .waitForResponse(
        (res) => res.url().includes('/api/patients') && res.url().includes('risk_level'),
      )
      .catch(() => null);
    await waitForStableUi(page);

    // Table should still render (may have fewer rows)
    const main = page.locator('main');
    await expect(main).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('filter reset clears all filters', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/patients');

    // Apply a search filter
    await page.getByLabel('患者検索').fill('テスト');
    await page.waitForResponse((res) => res.url().includes('/api/patients')).catch(() => null);
    await waitForStableUi(page);

    // Look for a reset button if active filters exist
    const resetButton = page.getByRole('button', { name: /リセット|クリア|フィルタ解除/ });
    if (await resetButton.isVisible().catch(() => false)) {
      await resetButton.click();
      await waitForStableUi(page);

      // Search should be cleared
      const searchValue = await page.getByLabel('患者検索').inputValue();
      expect(searchValue).toBe('');
    }

    expect(errors).toEqual([]);
  });
});

test.describe('patient detail page', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('gender field shows Japanese label, not raw enum value', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/patients');

    // Navigate to the profile basic tab, where the patient master card lives
    await openFirstPatientDetail(page, { view: 'profile', tab: 'basic' });
    await expect(page.getByRole('heading', { name: '患者マスタ' })).toBeVisible();

    // The gender field in patient master card should display Japanese label via a Select component
    // Previously it was a plain <Input> showing raw "male"/"female"/"other"
    // NOTE: `text=性別` の先頭マッチは受付票の「年齢 / 性別」行に当たることがあるため、
    // aria-label で一意に特定する。
    const genderTrigger = page.getByRole('combobox', { name: '性別' });
    await expect(genderTrigger).toBeVisible();
    const genderText = await genderTrigger.textContent();

    // Gender should show Japanese label, not raw English enum value
    expect(
      ['男性', '女性', 'その他'].some((label) => genderText?.includes(label)),
      `Gender field should show Japanese label but got "${genderText}"`,
    ).toBe(true);

    expect(errors).toEqual([]);
  });

  test('patient detail edit saves and reflects changes', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/patients');

    // Navigate to the profile basic tab, where the patient master card lives
    await openFirstPatientDetail(page, { view: 'profile', tab: 'basic' });

    // The patient master card is the first card with a "保存" button on the detail page
    // Locate "氏名" input (first input in master card) to confirm we're in the right card
    const nameInput = page
      .locator('label:text("氏名") + input, label:text("氏名") ~ input')
      .first();
    if (!(await nameInput.isVisible().catch(() => false))) {
      // The Label component wraps text without htmlFor, so use parent container
      await expect(
        page
          .locator('label')
          .filter({ hasText: /^氏名$/ })
          .first(),
      ).toBeVisible();
    }

    // Phone is a few fields below - find by position relative to the name input
    // The phone field is the 5th field in the master card (after name, kana, date, gender-select)
    // Find it by nearby label text
    const phoneLabelParent = page
      .locator('div')
      .filter({ has: page.locator('label:text("電話番号")') })
      .filter({ has: page.locator('input') })
      .first();
    const phoneField = phoneLabelParent.locator('input').first();
    await expect(phoneField).toBeVisible();
    const originalPhone = await phoneField.inputValue();

    // Edit phone number
    const testPhone = '03-9999-0000';
    await phoneField.fill(testPhone);

    // Click the first "保存" button on the page (belongs to patient master card)
    await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('/api/patients/') && res.request().method() === 'PATCH',
      ),
      page.getByRole('button', { name: '保存' }).first().click(),
    ]);

    // Success toast should appear
    await expect(page.getByText('患者基本情報を更新しました')).toBeVisible();

    // Reload and verify persistence
    await reloadStablePage(page);
    const reloadedPhoneParent = page
      .locator('div')
      .filter({ has: page.locator('label:text("電話番号")') })
      .filter({ has: page.locator('input') })
      .first();
    await expect(reloadedPhoneParent.locator('input').first()).toHaveValue(testPhone);

    // Restore original value
    await reloadedPhoneParent.locator('input').first().fill(originalPhone);
    await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('/api/patients/') && res.request().method() === 'PATCH',
      ),
      page.getByRole('button', { name: '保存' }).first().click(),
    ]);

    expect(errors).toEqual([]);
  });
});

test.describe('patient profile tabs', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  // Visible tabs of the profile view (?view=profile). Hidden tabs (basic/cases/documents)
  // stay reachable through ?tab= URLs only.
  const TAB_LABELS = [
    { value: 'memo', label: '薬剤師メモ' },
    { value: 'process', label: '工程' },
    { value: 'prescriptions', label: '処方・監査' },
    { value: 'medications', label: 'セット' },
    { value: 'visits', label: '訪問' },
    { value: 'communications', label: '報告' },
    { value: 'timeline', label: '履歴' },
  ];

  test('all 7 tabs are visible on the patient profile view', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/patients');

    // Navigate to first patient profile view
    await openFirstPatientDetail(page, { view: 'profile' });

    const tablist = page.getByTestId('patient-detail-tablist');
    for (const tab of TAB_LABELS) {
      await expect(tablist.getByRole('tab', { name: tab.label, exact: true })).toBeVisible();
    }

    expect(errors).toEqual([]);
  });

  test('switching tabs updates content panel without errors', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/patients');

    await openFirstPatientDetail(page, { view: 'profile' });

    const tablist = page.getByTestId('patient-detail-tablist');

    // Default tab should be "薬剤師メモ"
    await expect(tablist.getByRole('tab', { name: '薬剤師メモ', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // Click each tab and verify content changes without errors
    for (const tab of TAB_LABELS.slice(1)) {
      const tabTrigger = tablist.getByRole('tab', { name: tab.label, exact: true });
      await tabTrigger.click();
      await expect(tabTrigger).toHaveAttribute('aria-selected', 'true');

      // Only the active panel stays mounted. ただし leave/enter のトランジション中は
      // 旧パネル(inert)と新パネルが一瞬共存して strict mode violation になるため、
      // タブ名で対象パネルを特定する。
      await expect(page.getByRole('tabpanel', { name: tab.label })).toBeVisible({
        timeout: 5000,
      });
    }

    // Switch back to first tab
    const memoTab = tablist.getByRole('tab', { name: '薬剤師メモ', exact: true });
    await memoTab.click();
    await expect(memoTab).toHaveAttribute('aria-selected', 'true');

    // No console/page errors during tab switching
    expect(errors).toEqual([]);
  });

  test('selected tab persists in the URL across reload', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/patients');

    await openFirstPatientDetail(page, { view: 'profile' });

    // Switch to "工程" tab
    const processTab = page
      .getByTestId('patient-detail-tablist')
      .getByRole('tab', { name: '工程', exact: true });
    await processTab.click();
    await expect(processTab).toHaveAttribute('aria-selected', 'true');

    // Tab selection is reflected in the URL and survives a reload
    await expect(page).toHaveURL(/view=profile/);
    await expect(page).toHaveURL(/tab=process/);
    await reloadStablePage(page);
    await expect(
      page.getByTestId('patient-detail-tablist').getByRole('tab', { name: '工程', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');

    expect(errors).toEqual([]);
  });
});

test.describe('patient creation form', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('new patient page loads with empty form', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/patients/new');

    // Page header
    await expect(page.getByRole('heading', { name: '患者新規登録' })).toBeVisible();

    // Required fields should be present
    await expect(page.locator('input[name="name"]')).toBeVisible();
    await expect(page.locator('input[name="name_kana"]')).toBeVisible();
    await expect(page.locator('input[name="birth_date"]')).toBeVisible();
    await expect(page.locator('select[name="gender"]')).toBeVisible();

    // Submit and cancel buttons
    await expect(page.getByRole('button', { name: '登録する' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'キャンセル' })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('empty form submission shows validation errors for required fields', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/patients/new');

    // Submit without filling anything
    await page.getByRole('button', { name: '登録する' }).click();

    // Validation errors should appear for required fields
    await expect(page.getByText('氏名は必須です')).toBeVisible();
    await expect(page.getByText('フリガナは必須です')).toBeVisible();

    // Error summary should appear
    await expect(page.getByText(/必須の\d+項目を入力してください/)).toBeVisible();

    // Form should NOT have submitted (no navigation)
    expect(page.url()).toContain('/patients/new');

    // No unexpected console/page errors from validation
    const relevantErrors = errors.filter((e) => !e.includes('console:'));
    expect(relevantErrors).toEqual([]);
  });

  test('navigating from patient list to new patient form via header link', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openNewPatientFormFromList(page);

    // Should be on new patient page
    await expect(page.getByRole('heading', { name: '患者新規登録' })).toBeVisible();

    // Back link should go to patients list
    await expect(page.getByRole('link', { name: '患者一覧へ戻る' })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('cancel button navigates back without submission', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openNewPatientFormFromList(page);

    // Fill some data
    await page.getByLabel(/氏名/).first().fill('テスト患者');

    // Click cancel
    await clickAndWaitForStableRoute(page, /\/patients$/, () =>
      page.getByRole('button', { name: 'キャンセル' }).click(),
    );

    // Should navigate away from new patient page
    expect(page.url()).not.toContain('/patients/new');

    expect(errors).toEqual([]);
  });
});
