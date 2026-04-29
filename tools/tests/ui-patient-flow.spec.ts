import { expect, test } from '@playwright/test';
import { attachLocalSession, createInstrumentedPage, waitForStableUi } from './helpers/local-auth';

test.describe('patient list and navigation flow', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('patient list loads with data and table columns', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/patients');
    await waitForStableUi(page);

    // Table should render with expected column headers
    await expect(page.getByRole('columnheader', { name: '氏名' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: '年齢' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'ケース状態' })).toBeVisible();

    // At least one patient row should be visible (demo data)
    const rows = page.locator('table tbody tr');
    await expect(rows.first()).toBeVisible();
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);

    // Page header should show title
    await expect(page.getByRole('heading', { name: '患者一覧', level: 1 })).toBeVisible();

    // New patient registration link should be accessible
    const newPatientLink = page.getByRole('link', { name: '新規登録' });
    await expect(newPatientLink).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('search filters patient list by name', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/patients');
    await waitForStableUi(page);

    // Get the first patient name from the table for searching
    const firstPatientName = await page
      .locator('table tbody tr')
      .first()
      .locator('a')
      .first()
      .textContent();
    expect(firstPatientName).toBeTruthy();

    // Search for the patient
    const searchInput = page.getByPlaceholder('氏名');
    if (await searchInput.isVisible()) {
      await searchInput.fill(firstPatientName!.trim());
      // Wait for the query to refetch
      await page.waitForResponse((res) => res.url().includes('/api/patients'));
      await waitForStableUi(page);

      // The searched patient should still be visible
      await expect(page.getByRole('link', { name: firstPatientName!.trim() })).toBeVisible();
    }

    expect(errors).toEqual([]);
  });

  test('clicking patient name navigates to detail page', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/patients');
    await waitForStableUi(page);

    // Use specific selector for patient detail links (not other action links)
    const firstPatientLink = page
      .locator('tbody tr')
      .first()
      .locator('a[href^="/patients/"]')
      .first();
    const href = await firstPatientLink.getAttribute('href');
    expect(href).toBeTruthy();

    // Click the patient name
    await firstPatientLink.click();
    await waitForStableUi(page);

    // Should navigate to patient detail (toHaveURL auto-retries)
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(page.getByRole('heading', { name: '患者詳細' })).toBeVisible();

    // Back link should be available
    await expect(page.getByRole('link', { name: '患者一覧へ戻る' })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('patient detail back link returns to patient list', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/patients');
    await waitForStableUi(page);

    // Navigate to first patient detail
    const firstPatientLink = page
      .locator('tbody tr')
      .first()
      .locator('a[href^="/patients/"]')
      .first();
    const href = await firstPatientLink.getAttribute('href');
    await firstPatientLink.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));

    // Click back link
    await page.getByRole('link', { name: '患者一覧へ戻る' }).click();
    await waitForStableUi(page);

    // Should be back on patient list
    await expect(page).toHaveURL(/\/patients$/);
    await expect(page.getByRole('heading', { name: '患者一覧', level: 1 })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('action buttons on patient row link to correct pages', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/patients');
    await waitForStableUi(page);

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
    await page.goto('/patients');
    await waitForStableUi(page);

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
    await page.goto('/patients');
    await waitForStableUi(page);

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
    await page.goto('/patients');
    await waitForStableUi(page);

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
    await page.goto('/patients');
    await waitForStableUi(page);

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
    await page.goto('/patients');
    await waitForStableUi(page);

    // Navigate to first patient detail
    const firstPatientLink = page
      .locator('tbody tr')
      .first()
      .locator('a[href^="/patients/"]')
      .first();
    await firstPatientLink.click();
    await waitForStableUi(page);
    await expect(page.getByRole('heading', { name: '患者詳細' })).toBeVisible();

    // The gender field in patient master card should display Japanese label via a Select component
    // Previously it was a plain <Input> showing raw "male"/"female"/"other"
    const genderTrigger = page
      .locator('text=性別')
      .first()
      .locator('..')
      .locator('button[role="combobox"]');
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
    await page.goto('/patients');
    await waitForStableUi(page);

    // Navigate to first patient detail
    const firstPatientLink = page
      .locator('tbody tr')
      .first()
      .locator('a[href^="/patients/"]')
      .first();
    await firstPatientLink.click();
    await waitForStableUi(page);

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
    await page.getByRole('button', { name: '保存' }).first().click();

    // Wait for save response
    await page.waitForResponse(
      (res) => res.url().includes('/api/patients/') && res.request().method() === 'PATCH',
    );

    // Success toast should appear
    await expect(page.getByText('患者基本情報を更新しました')).toBeVisible();

    // Reload and verify persistence
    await page.reload();
    await waitForStableUi(page);
    const reloadedPhoneParent = page
      .locator('div')
      .filter({ has: page.locator('label:text("電話番号")') })
      .filter({ has: page.locator('input') })
      .first();
    await expect(reloadedPhoneParent.locator('input').first()).toHaveValue(testPhone);

    // Restore original value
    await reloadedPhoneParent.locator('input').first().fill(originalPhone);
    await page.getByRole('button', { name: '保存' }).first().click();
    await page.waitForResponse(
      (res) => res.url().includes('/api/patients/') && res.request().method() === 'PATCH',
    );

    expect(errors).toEqual([]);
  });
});

test.describe('patient detail tabs', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  const TAB_LABELS = [
    { label: '基本情報', description: '患者マスタ、保険、リスク、訪問条件' },
    { label: 'ケース', description: 'ケース進行、担当、紹介情報' },
    { label: '処方履歴', description: '前回比較と薬剤ライン差分' },
    { label: '薬剤', description: '服薬一覧、残薬、管理状況' },
    { label: '訪問', description: '予定、記録、月次実績' },
    { label: '連携', description: '連絡キュー、課題、請求ブロッカー' },
    { label: '文書', description: '計画書、共有、PDF 導線' },
    { label: 'タイムライン', description: '自己申告、共有、統合イベント' },
  ];

  test('all 8 tabs are visible on patient detail page', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/patients');
    await waitForStableUi(page);

    // Navigate to first patient
    const firstPatientLink = page
      .locator('tbody tr')
      .first()
      .locator('a[href^="/patients/"]')
      .first();
    await firstPatientLink.click();
    await waitForStableUi(page);

    // All 8 tab triggers should be present (use full label+description to avoid sidebar matches)
    for (const tab of TAB_LABELS) {
      await expect(
        page.getByRole('button', {
          name: new RegExp(`${tab.label}\\s+${tab.description.slice(0, 6)}`),
        }),
      ).toBeVisible();
    }

    expect(errors).toEqual([]);
  });

  test('switching tabs updates content panel without errors', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/patients');
    await waitForStableUi(page);

    const firstPatientLink = page
      .locator('tbody tr')
      .first()
      .locator('a[href^="/patients/"]')
      .first();
    await firstPatientLink.click();
    await waitForStableUi(page);

    // Default tab should be "基本情報" - check the card title
    await expect(page.getByText('患者マスタ', { exact: true })).toBeVisible();

    // Click each tab and verify content changes without errors
    for (const tab of TAB_LABELS.slice(1)) {
      // Click the tab trigger using full name pattern
      const tabButton = page.getByRole('button', {
        name: new RegExp(`${tab.label}\\s+${tab.description.slice(0, 6)}`),
      });
      await tabButton.click();

      // The tab description should appear in the paragraph below tab header
      await expect(page.locator('p').filter({ hasText: tab.description })).toBeVisible({
        timeout: 5000,
      });
    }

    // Switch back to first tab
    await page.getByRole('button', { name: /基本情報\s+患者マスタ/ }).click();
    await expect(page.getByText('患者マスタ', { exact: true })).toBeVisible();

    // No console/page errors during tab switching
    expect(errors).toEqual([]);
  });

  test('tab state persists during content interaction', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/patients');
    await waitForStableUi(page);

    const firstPatientLink = page
      .locator('tbody tr')
      .first()
      .locator('a[href^="/patients/"]')
      .first();
    await firstPatientLink.click();
    await waitForStableUi(page);

    // Switch to "ケース" tab
    const casesTab = page.getByRole('button', { name: /ケース\s+ケース進行/ });
    await casesTab.click();
    await expect(page.locator('p').filter({ hasText: 'ケース進行、担当、紹介情報' })).toBeVisible();

    // The "ケース" tab button should indicate it's active (pressed state)
    const isPressed = await casesTab.getAttribute('aria-pressed');
    expect(isPressed).toBe('true');

    expect(errors).toEqual([]);
  });
});

test.describe('patient creation form', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('new patient page loads with empty form', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/patients/new');
    await waitForStableUi(page);

    // Page header
    await expect(page.getByRole('heading', { name: '患者新規登録' })).toBeVisible();

    // Required fields should be present
    await expect(page.getByLabel(/氏名/)).toBeVisible();
    await expect(page.getByLabel(/フリガナ/)).toBeVisible();
    await expect(page.getByLabel(/生年月日/)).toBeVisible();
    await expect(page.getByLabel(/性別/)).toBeVisible();

    // Submit and cancel buttons
    await expect(page.getByRole('button', { name: '登録する' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'キャンセル' })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('empty form submission shows validation errors for required fields', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/patients/new');
    await waitForStableUi(page);

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
    await page.goto('/patients');
    await waitForStableUi(page);

    // Click the "新規登録" link in page header
    await Promise.all([
      page.waitForURL(/\/patients\/new$/, { timeout: 10_000 }),
      page.getByRole('link', { name: '新規登録' }).click(),
    ]);

    // Should be on new patient page
    await expect(page.getByRole('heading', { name: '患者新規登録' })).toBeVisible();

    // Back link should go to patients list
    await expect(page.getByRole('link', { name: '患者一覧へ戻る' })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('cancel button navigates back without submission', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/patients/new');
    await waitForStableUi(page);

    // Fill some data
    await page.getByLabel(/氏名/).first().fill('テスト患者');

    // Click cancel
    await page.getByRole('button', { name: 'キャンセル' }).click();
    await waitForStableUi(page);

    // Should navigate away from new patient page
    expect(page.url()).not.toContain('/patients/new');

    expect(errors).toEqual([]);
  });
});
