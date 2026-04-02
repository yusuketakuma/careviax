import fs from 'node:fs/promises';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  PLAYWRIGHT_ELEMENT_SCREENSHOT_DIR,
  PLAYWRIGHT_SCREENSHOT_DIR,
} from './helpers/artifacts';
import {
  attachLocalSession,
  createInstrumentedPage,
  waitForStableUi,
} from './helpers/local-auth';

const SCREENSHOT_DIR = PLAYWRIGHT_SCREENSHOT_DIR;
const ELEMENT_SCREEN_DIR = PLAYWRIGHT_ELEMENT_SCREENSHOT_DIR;

async function writeScreenshot(page: Page, name: string) {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, `${name}.png`),
    fullPage: true,
  });
}

async function writeElementScreenshot(locator: ReturnType<Page['locator']>, name: string) {
  await fs.mkdir(ELEMENT_SCREEN_DIR, { recursive: true });
  await locator.screenshot({
    path: path.join(ELEMENT_SCREEN_DIR, `${name}.png`),
  });
}

function summarizeViolations(
  violations: Array<{
    id: string;
    impact?: string | null;
    nodes: Array<{ target: unknown }>;
  }>
) {
  return violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact ?? 'unknown',
    targets: violation.nodes
      .flatMap((node) => {
        if (Array.isArray(node.target)) {
          return node.target.map((item) => String(item));
        }

        return [String(node.target)];
      })
      .slice(0, 6),
  }));
}

async function analyzeMainAccessibility(page: Page) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await new AxeBuilder({ page }).include('main').analyze();
    } catch (error) {
      const shouldRetry =
        error instanceof Error &&
        error.message.includes('Execution context was destroyed') &&
        attempt === 0;
      if (!shouldRetry) {
        throw error;
      }
      await waitForStableUi(page);
      await expect(page.locator('main')).toBeVisible();
    }
  }

  throw new Error('Axe analysis did not complete');
}

async function openFirstPatientDetail(page: Page) {
  await page.goto('/patients');
  await waitForStableUi(page);

  const patientLink = page.locator('tbody tr').first().locator('a[href^="/patients/"]').first();
  const href = await patientLink.getAttribute('href');
  expect(href).toBeTruthy();
  await page.goto(href!);
  await waitForStableUi(page);
  return href!;
}

test.beforeEach(async ({ context }) => {
  await attachLocalSession(context);
});

test('dashboard accessibility has no critical or serious violations', async ({ context }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');

  const { page, errors } = await createInstrumentedPage(context);
  await page.goto('/dashboard');
  await waitForStableUi(page);

  const results = await analyzeMainAccessibility(page);
  const severe = results.violations.filter((violation) =>
    ['critical', 'serious'].includes(violation.impact ?? '')
  );

  await writeScreenshot(page, 'dashboard-a11y');
  await expect(page.locator('main')).toBeVisible();
  expect(errors).toEqual([]);
  expect(summarizeViolations(severe)).toEqual([]);
});

test('patients accessibility has no critical or serious violations', async ({ context }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');

  const { page, errors } = await createInstrumentedPage(context);
  await page.goto('/patients');
  await waitForStableUi(page);

  const results = await analyzeMainAccessibility(page);
  const severe = results.violations.filter((violation) =>
    ['critical', 'serious'].includes(violation.impact ?? '')
  );

  const searchInput = page.getByLabel('患者検索');
  await expect(searchInput).toBeVisible();
  await writeScreenshot(page, 'patients-a11y');
  await writeElementScreenshot(searchInput, 'patients-search-input');
  expect(errors).toEqual([]);
  expect(summarizeViolations(severe)).toEqual([]);
});

test('prescription intake accessibility has no critical or serious violations', async ({ context }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');

  const { page, errors } = await createInstrumentedPage(context);
  await page.goto('/prescriptions/new');
  await waitForStableUi(page);

  const results = await analyzeMainAccessibility(page);
  const severe = results.violations.filter((violation) =>
    ['critical', 'serious'].includes(violation.impact ?? '')
  );

  await expect(page.locator('main')).toBeVisible();
  await writeScreenshot(page, 'prescription-intake-a11y');
  expect(errors).toEqual([]);
  expect(summarizeViolations(severe)).toEqual([]);
});

test('mobile dashboard keeps primary action accessible without horizontal overflow', async ({
  context,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium');

  const { page, errors } = await createInstrumentedPage(context);
  await page.goto('/dashboard');
  await waitForStableUi(page);

  const overflowWidth = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });

  const primaryAction = page.locator('main').getByRole('link', { name: /処方受付/ }).first();
  await expect(primaryAction).toBeVisible();
  const box = await primaryAction.boundingBox();

  await writeScreenshot(page, 'dashboard-mobile');
  await writeElementScreenshot(primaryAction, 'dashboard-mobile-primary-action');
  expect(errors).toEqual([]);
  expect(overflowWidth).toBeLessThanOrEqual(1);
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);
});

test('mobile patients screen preserves search usability without horizontal overflow', async ({
  context,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium');

  const { page, errors } = await createInstrumentedPage(context);
  await page.goto('/patients');
  await waitForStableUi(page);

  const searchInput = page.getByLabel('患者検索');
  await expect(searchInput).toBeVisible();

  const overflowWidth = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });
  const box = await searchInput.boundingBox();

  await writeScreenshot(page, 'patients-mobile');
  await writeElementScreenshot(searchInput, 'patients-mobile-search-input');
  expect(errors).toEqual([]);
  expect(overflowWidth).toBeLessThanOrEqual(1);
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);
});

test.describe('environment emulation audit', () => {
  test.use({ colorScheme: 'dark' });

  test('dashboard respects system dark mode without runtime errors', async ({ context }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/dashboard');
    await waitForStableUi(page);

    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.getByTestId('app-sidebar').first()).toBeVisible();
    await writeScreenshot(page, 'dashboard-dark-mode');
    expect(errors).toEqual([]);
  });
});

test.describe('motion and network audit', () => {
  test('dashboard remains usable with reduced motion preference', async ({ context }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    const { page, errors } = await createInstrumentedPage(context);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/dashboard');
    await waitForStableUi(page);

    const prefersReducedMotion = await page.evaluate(() =>
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );

    await writeScreenshot(page, 'dashboard-reduced-motion');
    expect(prefersReducedMotion).toBe(true);
    expect(errors).toEqual([]);
  });

  test('dashboard surfaces offline banner when network drops', async ({ context }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    const { page, errors } = await createInstrumentedPage(context, { captureHttpErrors: false });
    await page.addInitScript(() => {
      Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        get: () => false,
      });
    });
    await page.goto('/dashboard');
    await waitForStableUi(page);

    errors.length = 0;
    const offlineMessage = page.getByText('ネットワーク接続が切れています。').first();
    const offlineLink = page.getByText('オフライン時の案内を見る').first();
    await expect(offlineMessage).toBeVisible();
    await expect(offlineLink).toBeVisible();
    await writeElementScreenshot(offlineLink, 'dashboard-offline-link');
    expect(errors).toEqual([]);
  });
});

test.describe('locale and timezone audit', () => {
  test.use({ locale: 'en-US', timezoneId: 'America/Los_Angeles' });

  test('dashboard stays readable under alternate locale and timezone settings', async ({
    context,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/dashboard');
    await waitForStableUi(page);

    const runtimeLocale = await page.evaluate(() => navigator.language);
    const runtimeTimezone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);

    await expect(page.getByTestId('app-shell-main')).toBeVisible();
    await expect(page.locator('main').getByText(/CareViaX.*ダッシュボード/)).toBeVisible();
    await writeScreenshot(page, 'dashboard-locale-timezone');
    expect(runtimeLocale).toBe('en-US');
    expect(runtimeTimezone).toBe('America/Los_Angeles');
    expect(errors).toEqual([]);
  });
});

test.describe('ARIA and keyboard contracts', () => {
  test('dashboard sidebar link remains clickable without residual sheet overlay', async ({
    context,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/dashboard');
    await waitForStableUi(page);

    await Promise.all([
      page.waitForURL(/\/patients$/, { timeout: 20_000 }),
      page.getByTestId('sidebar-nav-patients').click(),
    ]);
    await expect(page.getByLabel('患者検索')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('patients table row opens patient detail by click', async ({ context }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/patients');
    await waitForStableUi(page);

    const patientLink = page.locator('tbody tr').first().locator('a[href^="/patients/"]').first();
    const href = await patientLink.getAttribute('href');
    expect(href).toBeTruthy();

    await patientLink.click();
    await waitForStableUi(page);

    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(page.locator('main').getByText('患者詳細').first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('dashboard sidebar navigation aria tree stays stable', async ({ context }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/dashboard');
    await waitForStableUi(page);

    await expect(page.getByRole('navigation', { name: 'ワークフローナビ' }).first()).toMatchAriaSnapshot(`
      - navigation "ワークフローナビ":
        - list:
          - listitem:
            - link "ホーム"
          - listitem:
            - link "患者"
          - listitem:
            - link /処方受付/
          - listitem:
            - link "スケジュール"
          - listitem:
            - link /調剤/
          - listitem:
            - link /鑑査/
          - listitem:
            - link /セット/
          - listitem:
            - link /訪問/
          - listitem:
            - link /報告/
          - listitem:
            - link "多職種連携"
          - listitem:
            - link "QRスキャン"
          - listitem:
            - link "申し送り"
        - paragraph: ワークベンチ
        - list:
          - listitem:
            - link "My Day"
          - listitem:
            - link "ワークフロー"
          - listitem:
            - link "タスク"
          - listitem:
            - link "請求"
          - listitem:
            - link "管理"
          - listitem:
            - link "通知"
          - listitem:
            - link "依頼・照会"
          - listitem:
            - link "外部連携"
        - paragraph: 管理
        - list:
          - listitem:
            - button "運営"
          - listitem:
            - button "スタッフ"
          - listitem:
            - button "施設・連携先"
          - listitem:
            - button "薬剤"
          - listitem:
            - button "文書・通知"
          - listitem:
            - button "分析・監視"
          - listitem:
            - button "その他"
    `);

    expect(errors).toEqual([]);
  });

  test('dashboard sidebar supports sequential keyboard navigation', async ({ context }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/dashboard');
    await waitForStableUi(page);

    const homeLink = page.getByTestId('sidebar-nav-home').first();
    const patientsLink = page.getByTestId('sidebar-nav-patients').first();

    await homeLink.focus();
    await expect(homeLink).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(patientsLink).toBeFocused();

    expect(errors).toEqual([]);
  });

  test('dashboard sidebar patients link remains clickable without dismissing overlays', async ({
    context,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/dashboard');
    await waitForStableUi(page);

    await page.getByTestId('sidebar-nav-patients').first().click();
    await expect(page).toHaveURL(/\/patients$/);
    await expect(page.getByLabel('患者検索')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('patients row click opens patient detail without sheet interference', async ({
    context,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/patients');
    await waitForStableUi(page);

    const patientLink = page.locator('tbody tr').first().locator('a[href^="/patients/"]').first();
    await patientLink.click();
    await expect(page).toHaveURL(/\/patients\/[^/]+$/);
    await expect(page.getByRole('heading', { name: '患者詳細' })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('patient detail mobile tabs keep aria structure and arrow-key navigation', async ({
    context,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');
    test.setTimeout(60_000);

    const { page, errors } = await createInstrumentedPage(context);
    await page.setViewportSize({ width: 390, height: 844 });

    await openFirstPatientDetail(page);

    const tablist = page.getByTestId('patient-detail-tablist');
    const basicTab = tablist.getByRole('tab', { name: '基本情報' });
    const casesTab = tablist.getByRole('tab', { name: 'ケース' });

    await expect(tablist).toBeVisible();
    await expect(tablist).toMatchAriaSnapshot(`
      - tablist "患者詳細タブ":
        - tab "基本情報" [selected]
        - tab "ケース"
        - tab "処方履歴"
        - tab "薬剤"
        - tab "訪問"
        - tab "連携"
        - tab "文書"
        - tab "タイムライン"
    `);

    await basicTab.focus();
    await expect(basicTab).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(casesTab).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(casesTab).toHaveAttribute('aria-selected', 'true');

    expect(errors).toEqual([]);
  });

  test('patient MCS page surfaces setup guidance before the first sync', async ({
    context,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    const { page, errors } = await createInstrumentedPage(context);
    await openFirstPatientDetail(page);
    await page.goto(`${page.url()}/mcs`);
    await waitForStableUi(page);

    await expect(page.getByTestId('patient-mcs-setup-guide')).toBeVisible();
    await expect(page.getByRole('button', { name: 'URL を入力する' })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('prescription intake form keeps accessible labeling and keyboard flow', async ({
    context,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/prescriptions/new');
    await waitForStableUi(page);

    const form = page.getByTestId('prescription-intake-form');
    const sourceType = page.getByTestId('prescription-source-type');
    const prescribedDate = page.getByTestId('prescription-prescribed-date');

    await expect(form).toBeVisible();
    await expect(form).toHaveAttribute('aria-label', '処方受付フォーム');

    await sourceType.focus();
    await expect(sourceType).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(prescribedDate).toBeFocused();
    await expect(page.getByTestId('prescription-submit-summary')).toContainText(
      '最後にこのボタンで受付を確定します'
    );

    expect(errors).toEqual([]);
  });

  test('patient mcs screen explains the first setup step when unlinked', async ({
    context,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    const { page, errors } = await createInstrumentedPage(context);
    const patientHref = await openFirstPatientDetail(page);

    await page.goto(`${patientHref}/mcs`);
    await waitForStableUi(page);

    await expect(page.locator('main').getByText('最初に必要な設定')).toBeVisible();
    await expect(page.locator('main').getByRole('button', { name: 'URL を入力する' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('patient mcs screen rejects invalid draft urls before enabling sync actions', async ({
    context,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    const { page, errors } = await createInstrumentedPage(context);
    const patientHref = await openFirstPatientDetail(page);

    await page.goto(`${patientHref}/mcs`);
    await waitForStableUi(page);

    const sourceInput = page.getByLabel('MCS 連携元 URL');
    await sourceInput.fill('invalid-url');

    await expect(
      page.getByText('MCS の患者 URL または医療・介護側タイムライン URL を入力してください')
    ).toBeVisible();
    await expect(page.getByRole('button', { name: '今すぐ同期' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'MCS で開く' })).toBeDisabled();
    await expect(page.getByRole('button', { name: '患者ページ' })).toBeDisabled();

    expect(errors).toEqual([]);
  });

  test('prescription intake keeps the final submit guidance visible', async ({
    context,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/prescriptions/new');
    await waitForStableUi(page);

    await expect(page.locator('main').getByText('最後にこのボタンで受付を確定します')).toBeVisible();
    await expect(page.getByRole('button', { name: '処方受付を登録' })).toBeVisible();
    expect(errors).toEqual([]);
  });
});
