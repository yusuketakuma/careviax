import { expect, test, type Page } from '@playwright/test';
import {
  attachLocalSession,
  clickAndWaitForStableRoute,
  createInstrumentedPage,
  openStableRoute,
  waitForStableUi,
} from './helpers/local-auth';

test.setTimeout(120_000);

const PATIENT_BOARD_SEARCH_LABEL = '氏名・状態で検索';
const PATIENT_BOARD_CARD_TIMEOUT_MS = 60_000;

async function openFirstPatientDetail(page: Page, options: { mode?: 'click' | 'open' } = {}) {
  // 遷移の起点は /patients 最上部の patients-board カード(氏名リンク)。
  // board カードは全ビューポートで表示される。
  const firstPatientLink = page.getByTestId('patient-board-card-link').first();
  await expect(firstPatientLink).toBeVisible({ timeout: PATIENT_BOARD_CARD_TIMEOUT_MS });
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

    await page.getByRole('searchbox', { name: PATIENT_BOARD_SEARCH_LABEL }).fill(cardPatientName!);
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
    await expect(page.getByRole('searchbox', { name: PATIENT_BOARD_SEARCH_LABEL })).toBeVisible();
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
    const searchInput = page.getByRole('searchbox', { name: PATIENT_BOARD_SEARCH_LABEL });
    await searchInput.fill('ZZZZNONEXISTENT');

    await expect(page.getByText('条件に一致する患者がいません')).toBeVisible();
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

    await openFirstPatientDetail(page, { mode: 'open' });

    const editLink = page.getByRole('link', { name: '基本情報を編集' });
    await expect(editLink).toHaveAttribute('href', /\/patients\/.+\/edit$/);
    await editLink.focus();
    await page.keyboard.press('Enter');
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 30_000 })
      .toMatch(/\/patients\/.+\/edit$/);
    await waitForStableUi(page);

    await expect(page.locator('input[name="name"]')).toBeVisible({ timeout: 30_000 });

    await page.getByRole('tab', { name: '住所・保険' }).click();

    const phoneField = page.locator('input[name="phone"]');
    await expect(phoneField).toBeVisible({ timeout: 30_000 });
    const originalPhone = await phoneField.inputValue();
    const editPath = new URL(page.url()).pathname;

    // Edit phone number
    const testPhone = '03-9999-0000';
    await phoneField.fill(testPhone);

    // Click the first "保存" button on the page (belongs to patient master card)
    await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('/api/patients/') && res.request().method() === 'PATCH',
      ),
      page.getByRole('button', { name: '保存する' }).click(),
    ]);

    // Re-open edit form and verify persistence after the save redirect.
    await openStableRoute(page, editPath);
    await page.getByRole('tab', { name: '住所・保険' }).click();
    await expect(page.getByRole('textbox', { name: /^電話番号$/ })).toHaveValue(testPhone);

    // Restore original value
    await page.getByRole('textbox', { name: /^電話番号$/ }).fill(originalPhone);
    await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('/api/patients/') && res.request().method() === 'PATCH',
      ),
      page.getByRole('button', { name: '保存する' }).click(),
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
    await waitForStableUi(page);

    // Use the current page-header back link. The new patient form does not expose a separate
    // legacy cancel button.
    const backLink = page.getByRole('link', { name: '患者一覧へ戻る' });
    await expect(backLink).toHaveAttribute('href', '/patients');
    await backLink.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 }).toBe('/patients');
    await waitForStableUi(page);

    // Should navigate away from new patient page
    await expect(page).toHaveURL(/\/patients$/);
    await expect(page.getByTestId('patients-board')).toBeVisible({ timeout: 30_000 });

    expect(errors).toEqual([]);
  });
});
