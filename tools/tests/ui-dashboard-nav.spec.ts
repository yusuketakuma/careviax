import { expect, test } from '@playwright/test';
import {
  attachLocalSession,
  clickAndWaitForStableRoute,
  createInstrumentedPage,
  openStableRoute,
} from './helpers/local-auth';

test.describe('dashboard page', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('dashboard loads with cockpit sections', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    // 条件バナーは viewport 条件なしで常時表示する(xl 境界 1280px で回帰検証)。
    // dev サーバーのコールドコンパイル時は集計 API が遅れるため待ち時間を広げる。
    await page.setViewportSize({ width: 1280, height: 720 });
    await openStableRoute(page, '/dashboard');

    // 新デザインのコックピット(条件バナー+今すぐ対応)
    await expect(page.getByRole('heading', { name: 'ダッシュボード' }).first()).toBeVisible();
    await expect(page.getByTestId('dashboard-condition-banner')).toBeVisible({ timeout: 30_000 });

    expect(errors).toEqual([]);
  });

  test('dashboard renders actionable content in the main region', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/dashboard');

    const main = page.locator('main');
    const interactiveCount = await main.locator('a, button').count();
    expect(interactiveCount).toBeGreaterThan(0);

    expect(errors).toEqual([]);
  });
});

// design/images/new のサイドバー: 5 グループ(今日/患者/工程/連携/管理)・フラット項目
test.describe('sidebar navigation', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('sidebar shows the grouped navigation items', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.setViewportSize({ width: 1600, height: 900 });
    await openStableRoute(page, '/dashboard');

    const sidebar = page.getByTestId('app-sidebar');

    // グループ見出し
    for (const heading of ['今日', '患者', '工程', '連携', '管理']) {
      await expect(sidebar.getByText(heading, { exact: true })).toBeVisible();
    }

    // 主要項目(各グループの代表)
    for (const label of [
      'ダッシュボード',
      'スケジュール',
      '訪問',
      '患者一覧',
      '処方取込',
      'カード',
      '調剤',
      '監査',
      'セット',
      '報告・共有',
      '算定チェック',
      'ハンドオフ',
      'マスター',
      '設定',
    ]) {
      // バッジ付き項目(監査 6 等)があるため部分一致
      await expect(sidebar.getByRole('link', { name: label }).first()).toBeVisible();
    }

    expect(errors).toEqual([]);
  });

  test('clicking sidebar patient list link navigates to patients page', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.setViewportSize({ width: 1600, height: 900 });
    await openStableRoute(page, '/dashboard');

    const sidebar = page.getByTestId('app-sidebar');
    await clickAndWaitForStableRoute(page, /\/patients$/, () =>
      sidebar.getByRole('link', { name: '患者一覧' }).click(),
    );

    await expect(page.getByRole('heading', { name: '患者一覧' }).first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('sidebar highlights active route correctly', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.setViewportSize({ width: 1600, height: 900 });
    await openStableRoute(page, '/patients');

    const sidebar = page.getByTestId('app-sidebar');
    await expect(sidebar.getByRole('link', { name: '患者一覧' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    expect(errors).toEqual([]);
  });

  test('settings link navigates to settings', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.setViewportSize({ width: 1600, height: 900 });
    await openStableRoute(page, '/dashboard');

    const sidebar = page.getByTestId('app-sidebar');
    const settingsLink = sidebar.getByRole('link', { name: '設定' });
    await expect(settingsLink).toBeVisible();

    await clickAndWaitForStableRoute(page, /\/settings$/, () => settingsLink.click());

    expect(errors).toEqual([]);
  });

  test('logout button is visible in sidebar', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.setViewportSize({ width: 1600, height: 900 });
    await openStableRoute(page, '/dashboard');

    const sidebar = page.getByTestId('app-sidebar');
    await expect(sidebar.getByRole('button', { name: 'ログアウト' })).toBeVisible();

    expect(errors).toEqual([]);
  });
});

// design/images/new でパンくずは廃止(上部バーはモード/検索/同期/通知)。
// 現在地はサイドバーのアクティブ表示で示す。
test.describe('global navigation', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('patient detail highlights the card nav item instead of breadcrumbs', async ({
    context,
  }) => {
    const { page, errors } = await createInstrumentedPage(context);
    // デスクトップサイドバー(展開状態)を検証するため xl 超の幅にする
    await page.setViewportSize({ width: 1600, height: 900 });
    await openStableRoute(page, '/patients');

    // Navigate to patient detail (= card workspace)
    const firstPatientLink = page
      .locator('tbody tr')
      .first()
      .locator('a[href^="/patients/"]')
      .first();
    const href = await firstPatientLink.getAttribute('href');
    expect(href).toBeTruthy();
    await clickAndWaitForStableRoute(page, new RegExp(`${href}$`), () =>
      firstPatientLink.click({ noWaitAfter: true }),
    );

    // パンくずは描画されない
    await expect(page.getByRole('navigation', { name: 'パンくずリスト' })).toHaveCount(0);

    // サイドバーの現在地: カード=アクティブ、患者一覧=非アクティブ
    const sidebar = page.getByTestId('app-sidebar');
    await expect(sidebar.getByRole('link', { name: 'カード' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(sidebar.getByRole('link', { name: '患者一覧' })).not.toHaveAttribute(
      'aria-current',
      'page',
    );

    expect(errors).toEqual([]);
  });

  test('sidebar dashboard link navigates to the cockpit', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    // デスクトップサイドバー(展開状態)を検証するため xl 超の幅にする
    await page.setViewportSize({ width: 1600, height: 900 });
    await openStableRoute(page, '/patients');

    const sidebar = page.getByTestId('app-sidebar');
    await clickAndWaitForStableRoute(page, /\/dashboard$/, () =>
      sidebar.getByRole('link', { name: 'ダッシュボード' }).click(),
    );

    await expect(page.getByTestId('dashboard-condition-banner')).toBeVisible({ timeout: 30_000 });
    expect(errors).toEqual([]);
  });
});
