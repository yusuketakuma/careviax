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

async function openFirstPatientDetail(page: Page, options: { mode?: 'click' | 'open' } = {}) {
  // 遷移の起点は /patients 最上部の patients-board カード(氏名リンク)。
  // board カードは全ビューポートで表示される。
  const firstPatientLink = page.getByTestId('patient-board-card-link').first();
  await expect(firstPatientLink).toBeVisible({ timeout: 30_000 });
  const href = (await firstPatientLink.getAttribute('href')) ?? '';
  expect(href).toBeTruthy();

  if (options.mode === 'open') {
    await openStableRoute(page, href);
  } else {
    await clickAndWaitForStableRoute(page, new RegExp(`${href}$`), () =>
      firstPatientLink.click({ noWaitAfter: true }),
    );
  }
  await expect(page.getByTestId('card-workspace')).toBeVisible({ timeout: 30_000 });
  return href!;
}

async function openNewPatientFormFromList(page: Page) {
  await openStableRoute(page, '/patients/new');
  await expect(page.getByRole('heading', { name: '患者新規登録' })).toBeVisible();
}

test.describe('patient list and navigation flow', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('patient list loads with board cards', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/patients');

    const cards = page.getByTestId('patient-board-card');
    await expect(cards.first()).toBeVisible({ timeout: 30_000 });
    expect(await cards.count()).toBeGreaterThan(0);

    // Page header should show title
    await expect(page.getByRole('heading', { name: '患者一覧', level: 1 })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('search filters patient list by name', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/patients');

    const firstCardLink = page.getByTestId('patient-board-card-link').first();
    await expect(firstCardLink).toBeVisible({ timeout: 30_000 });
    const cardPatientName = (await firstCardLink.textContent())?.trim();
    expect(cardPatientName).toBeTruthy();

    await page.getByLabel('氏名・住所で検索').fill(cardPatientName!);
    await expect(
      page.getByTestId('patient-board-card-link').filter({ hasText: cardPatientName! }).first(),
    ).toBeVisible();

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

    const profileJump = page.getByTestId('card-open-profile');
    await expect(profileJump).toBeVisible();
    await expect(profileJump).toHaveAttribute('href', '#patient-profile-summary');
    await expect(page.getByTestId('patient-profile-summary')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('patient detail keeps profile information in the current card workspace', async ({
    context,
  }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/patients');

    const href = await openFirstPatientDetail(page);
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(page.getByTestId('patient-detail-tablist')).toHaveCount(0);
    await expect(page.getByTestId('patient-profile-summary')).toBeVisible();
    await expect(page.getByRole('heading', { name: '患者プロフィール' })).toBeVisible();
    await expect(page.getByRole('link', { name: '基本情報を編集' })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('patient board card action opens the current card workspace', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/patients');

    const firstCard = page.getByTestId('patient-board-card').first();
    await expect(firstCard).toBeVisible({ timeout: 30_000 });
    const detailLink = firstCard.getByTestId('patient-board-card-link');
    const detailHref = await detailLink.getAttribute('href');
    expect(detailHref).toMatch(/\/patients\/.+/);

    await clickAndWaitForStableRoute(page, new RegExp(`${detailHref}$`), () =>
      detailLink.click({ noWaitAfter: true }),
    );
    await expect(page.getByTestId('card-workspace')).toBeVisible();
    await expect(page.getByTestId('patient-profile-summary')).toBeVisible();

    expect(errors).toEqual([]);
  });
});

test.describe('patient list filters', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('current patient board controls are visible without the legacy table surface', async ({
    context,
  }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/patients');

    await expect(page.getByTestId('patients-board')).toBeVisible();
    await expect(page.getByLabel('氏名・住所で検索')).toBeVisible();
    await expect(page.getByLabel('担当範囲の切替')).toBeVisible();
    await expect(page.getByLabel('対応カテゴリの絞り込み')).toBeVisible();
    await expect(page.getByTestId('patients-board-grid')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('table')).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test('search input filters the patient board cards', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/patients');

    await expect(page.getByTestId('patients-board-grid')).toBeVisible({ timeout: 30_000 });
    const cardsBefore = await page.getByTestId('patient-board-card').count();
    expect(cardsBefore).toBeGreaterThan(0);

    // Type a search that's unlikely to match any patient
    const searchInput = page.getByLabel('氏名・住所で検索');
    await searchInput.fill('ZZZZNONEXISTENT');

    await expect(page.getByText('条件に一致する患者がいません。')).toBeVisible();
    await expect(page.getByTestId('patient-board-card')).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test('category filter keeps the current board surface visible', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/patients');

    await expect(page.getByLabel('対応カテゴリの絞り込み')).toBeVisible();
    await page.getByRole('button', { name: '本日訪問' }).click();
    await waitForStableUi(page);

    await expect(page.getByTestId('patients-board')).toBeVisible();
    await expect(page.locator('table')).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test('scope toggle keeps the current board surface visible', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/patients');

    await page.getByRole('button', { name: '全員' }).click();
    await waitForStableUi(page);

    await expect(page.getByTestId('patients-board-scope-note')).toContainText('全体');
    await expect(page.getByTestId('patients-board')).toBeVisible();
    await expect(page.locator('table')).toHaveCount(0);

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

    await openFirstPatientDetail(page);
    const profileSummary = page.getByTestId('patient-profile-summary');
    await expect(profileSummary).toBeVisible();
    await expect(profileSummary).toContainText(/男性|女性|その他/);
    await expect(profileSummary).not.toContainText(/\bmale\b|\bfemale\b|\bother\b/);

    expect(errors).toEqual([]);
  });

  test('patient detail edit saves and reflects changes', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/patients');

    await openFirstPatientDetail(page);

    await clickAndWaitForStableRoute(page, /\/patients\/.+\/edit$/, () =>
      page.getByRole('link', { name: '基本情報を編集' }).click({ noWaitAfter: true }),
    );

    // Locate "氏名" input to confirm we're in the edit screen.
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

  test('patient registration route loads from the current app route', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openNewPatientFormFromList(page);

    // Should be on new patient page
    await expect(page.getByRole('heading', { name: '患者新規登録' })).toBeVisible();

    // Back link should go to patients list
    await expect(page.getByRole('link', { name: '患者一覧へ戻る' })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('back link navigates away without submission', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openNewPatientFormFromList(page);

    // Fill some data
    await page.getByLabel(/氏名/).first().fill('テスト患者');

    // Use the current page-header back link. The new patient form does not expose a separate
    // legacy cancel button.
    await clickAndWaitForStableRoute(page, /\/patients$/, () =>
      page.getByRole('link', { name: '患者一覧へ戻る' }).click({ noWaitAfter: true }),
    );

    // Should navigate away from new patient page
    expect(page.url()).not.toContain('/patients/new');

    expect(errors).toEqual([]);
  });
});
