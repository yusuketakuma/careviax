import fs from 'node:fs/promises';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { PLAYWRIGHT_ELEMENT_SCREENSHOT_DIR, PLAYWRIGHT_SCREENSHOT_DIR } from './helpers/artifacts';
import {
  attachLocalSession,
  clickAndWaitForStableRoute,
  createInstrumentedPage,
  openStableRoute,
  reloadStablePage,
  waitForStableUi,
} from './helpers/local-auth';

const SCREENSHOT_DIR = PLAYWRIGHT_SCREENSHOT_DIR;
const ELEMENT_SCREEN_DIR = PLAYWRIGHT_ELEMENT_SCREENSHOT_DIR;
const FALLBACK_PATIENT_PATH = '/patients/e2e_mobile_qr_draft_patient';
const PATIENT_BOARD_SEARCH_LABEL = '氏名・状態で検索';
let cachedPatientDetailHref: string | null = null;

test.setTimeout(240_000);

async function writeScreenshot(page: Page, name: string) {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, `${name}.png`),
    fullPage: true,
    caret: 'initial',
  });
}

async function writeElementScreenshot(locator: ReturnType<Page['locator']>, name: string) {
  await fs.mkdir(ELEMENT_SCREEN_DIR, { recursive: true });
  await locator.screenshot({
    path: path.join(ELEMENT_SCREEN_DIR, `${name}.png`),
    caret: 'initial',
  });
}

async function openNavigationDrawer(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'ナビを開く' }).click();
  const drawer = page.getByRole('dialog', { name: 'ナビゲーション' });
  await expect(drawer).toBeVisible();
  return drawer;
}

async function clickLinkAndRequireRoute(
  page: Page,
  link: Locator,
  targetUrl: Parameters<Page['waitForURL']>[0],
  options: { timeout?: number } = {},
) {
  const timeout = options.timeout ?? 30_000;
  await expect(link).toBeVisible({ timeout });
  const href = await link.getAttribute('href');
  if (!href) throw new Error('Navigation link did not expose an href');

  await link.scrollIntoViewIfNeeded();
  await expect(link).toBeEnabled({ timeout });
  await link.click({ noWaitAfter: true });
  await page.waitForURL(targetUrl, { timeout, waitUntil: 'domcontentloaded' });
  await waitForStableUi(page);
}

function summarizeViolations(
  violations: Array<{
    id: string;
    impact?: string | null;
    nodes: Array<{ target: unknown }>;
  }>,
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
  const patientLink = page.getByTestId('patient-board-card-link').first();
  const empty = page.locator('main').getByText('条件に一致する患者がいません');

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt === 0) {
      await openStableRoute(page, '/patients');
    } else {
      await reloadStablePage(page);
    }

    if (await patientLink.isVisible({ timeout: 30_000 }).catch(() => false)) {
      break;
    }

    if (await empty.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await page.getByRole('button', { name: '全員', exact: true }).click();
      if (await patientLink.isVisible({ timeout: 30_000 }).catch(() => false)) {
        break;
      }
    }
  }

  await expect(patientLink).toBeVisible({ timeout: 60_000 });
  const href = (await patientLink.getAttribute('href')) ?? FALLBACK_PATIENT_PATH;
  expect(href).toBeTruthy();
  await openStableRoute(page, href!);
  await expect(page.getByTestId('card-workspace')).toBeVisible({ timeout: 60_000 });
  cachedPatientDetailHref = href!;
  return href!;
}

async function openFirstPatientMcs(page: Page) {
  const patientHref = cachedPatientDetailHref ?? (await openFirstPatientDetail(page));
  await openStableRoute(page, `${patientHref}/mcs`);
}

test.beforeEach(async ({ context }) => {
  await attachLocalSession(context);
});

test('dashboard accessibility has no critical or serious violations', async ({
  context,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');

  const { page, errors } = await createInstrumentedPage(context);
  await openStableRoute(page, '/dashboard');

  const results = await analyzeMainAccessibility(page);
  const severe = results.violations.filter((violation) =>
    ['critical', 'serious'].includes(violation.impact ?? ''),
  );

  await writeScreenshot(page, 'dashboard-a11y');
  await expect(page.locator('main')).toBeVisible();
  expect(errors).toEqual([]);
  expect(summarizeViolations(severe)).toEqual([]);
});

test('patients accessibility has no critical or serious violations', async ({
  context,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');

  const { page, errors } = await createInstrumentedPage(context);
  await openStableRoute(page, '/patients');

  const results = await analyzeMainAccessibility(page);
  const severe = results.violations.filter((violation) =>
    ['critical', 'serious'].includes(violation.impact ?? ''),
  );

  const searchInput = page.getByRole('searchbox', { name: PATIENT_BOARD_SEARCH_LABEL });
  await expect(searchInput).toBeVisible();
  await writeScreenshot(page, 'patients-a11y');
  await writeElementScreenshot(searchInput, 'patients-search-input');
  expect(errors).toEqual([]);
  expect(summarizeViolations(severe)).toEqual([]);
});

test('prescription intake accessibility has no critical or serious violations', async ({
  context,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');

  const { page, errors } = await createInstrumentedPage(context);
  await openStableRoute(page, '/prescriptions/new');

  const results = await analyzeMainAccessibility(page);
  const severe = results.violations.filter((violation) =>
    ['critical', 'serious'].includes(violation.impact ?? ''),
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
  await openStableRoute(page, '/dashboard');

  const overflowWidth = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });

  const primaryAction = page
    .locator('main')
    .getByRole('link', { name: /処方受付/ })
    .first();
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
  await openStableRoute(page, '/patients');

  const searchInput = page.getByRole('searchbox', { name: PATIENT_BOARD_SEARCH_LABEL });
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

  test('dashboard respects system dark mode without runtime errors', async ({
    context,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/dashboard');

    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.getByRole('button', { name: 'ナビを開く' })).toBeVisible();
    const drawer = await openNavigationDrawer(page);
    await expect(drawer.getByRole('link', { name: '患者一覧' })).toBeVisible();
    await writeScreenshot(page, 'dashboard-dark-mode');
    expect(errors).toEqual([]);
  });
});

test.describe('motion and network audit', () => {
  test('dashboard remains usable with reduced motion preference', async ({ context }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    const { page, errors } = await createInstrumentedPage(context);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openStableRoute(page, '/dashboard');

    const prefersReducedMotion = await page.evaluate(
      () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
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
    await openStableRoute(page, '/dashboard');

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
    await openStableRoute(page, '/dashboard');

    const runtimeLocale = await page.evaluate(() => navigator.language);
    const runtimeTimezone = await page.evaluate(
      () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    );

    await expect(page.getByTestId('app-shell-main')).toBeVisible();
    await expect(page.locator('main').getByText(/PH-OS.*ダッシュボード/)).toBeVisible();
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
    await openStableRoute(page, '/dashboard');

    await clickAndWaitForStableRoute(
      page,
      /\/patients$/,
      async () => {
        const drawer = await openNavigationDrawer(page);
        await drawer.getByTestId('sidebar-nav-patients').click();
      },
      { timeout: 20_000 },
    );
    await expect(page.getByRole('searchbox', { name: PATIENT_BOARD_SEARCH_LABEL })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('patients board card opens patient detail by click', async ({ context }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/dashboard');
    await openStableRoute(page, '/patients');

    const patientLink = page.getByTestId('patient-board-card-link').first();
    const hasBoardCard = await patientLink.isVisible({ timeout: 10_000 }).catch(() => false);
    const href = hasBoardCard ? await patientLink.getAttribute('href') : FALLBACK_PATIENT_PATH;
    expect(href).toBeTruthy();

    if (hasBoardCard) {
      await clickAndWaitForStableRoute(page, href!, () => patientLink.click(), { timeout: 60_000 });
    } else {
      await openStableRoute(page, href!);
    }

    await expect(page.getByTestId('card-workspace')).toBeVisible({ timeout: 60_000 });
    expect(errors).toEqual([]);
  });

  test('dashboard sidebar navigation aria tree stays stable', async ({ context }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/dashboard');

    const drawer = await openNavigationDrawer(page);
    const nav = drawer.getByRole('navigation', { name: 'ワークフローナビ' }).first();
    await expect(nav).toBeVisible();
    await expect(nav.getByText('今日', { exact: true })).toBeVisible();
    await expect(nav.getByText('患者', { exact: true })).toBeVisible();
    await expect(nav.getByText('工程', { exact: true })).toBeVisible();
    await expect(nav.getByText('連携', { exact: true })).toBeVisible();
    await expect(nav.getByText('管理', { exact: true })).toBeVisible();

    for (const [testId, href] of [
      ['sidebar-nav-home', '/dashboard'],
      ['sidebar-nav-schedules', '/schedules'],
      ['sidebar-nav-visits', '/visits'],
      ['sidebar-nav-patients', '/patients'],
      ['sidebar-nav-prescriptions-intake', '/prescriptions/intake'],
      ['sidebar-nav-prescriptions', '/prescriptions'],
      ['sidebar-nav-dispense', '/dispense'],
      ['sidebar-nav-audit', '/audit'],
      ['sidebar-nav-set', '/set'],
      ['sidebar-nav-set-audit', '/set-audit'],
      ['sidebar-nav-reports', '/reports'],
      ['sidebar-nav-billing', '/billing'],
      ['sidebar-nav-handoff', '/handoff'],
      ['sidebar-nav-admin', '/admin'],
      ['sidebar-nav-settings', '/settings'],
    ] as const) {
      await expect(nav.getByTestId(testId)).toHaveAttribute('href', href);
    }

    expect(errors).toEqual([]);
  });

  test('dashboard sidebar supports sequential keyboard navigation', async ({
    context,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/dashboard');

    const drawer = await openNavigationDrawer(page);
    const homeLink = drawer.getByTestId('sidebar-nav-home').first();
    const schedulesLink = drawer.getByTestId('sidebar-nav-schedules').first();

    await homeLink.focus();
    await expect(homeLink).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(schedulesLink).toBeFocused();

    expect(errors).toEqual([]);
  });

  test('dashboard sidebar patients link remains clickable without dismissing overlays', async ({
    context,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/dashboard');

    const drawer = await openNavigationDrawer(page);
    await clickLinkAndRequireRoute(
      page,
      drawer.getByTestId('sidebar-nav-patients').first(),
      /\/patients$/,
      { timeout: 20_000 },
    );
    await expect(page).toHaveURL(/\/patients$/);
    await expect(page.getByRole('searchbox', { name: PATIENT_BOARD_SEARCH_LABEL })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('patients board card click opens patient detail without sheet interference', async ({
    context,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/patients');

    const patientLink = page.getByTestId('patient-board-card-link').first();
    await expect(patientLink).toBeVisible({ timeout: 60_000 });
    const href = await patientLink.getAttribute('href');
    expect(href).toBeTruthy();
    await clickLinkAndRequireRoute(page, patientLink, /\/patients\/[^/]+$/, { timeout: 60_000 });
    await expect(page.getByTestId('card-workspace')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('heading', { name: /カード — / })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('patient detail mobile card keeps profile and primary actions reachable', async ({
    context,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    const { page, errors } = await createInstrumentedPage(context);
    await page.setViewportSize({ width: 390, height: 844 });

    await openFirstPatientDetail(page);

    await expect(page.getByTestId('card-workspace')).toBeVisible();
    await expect(page.getByTestId('patient-profile-summary')).toBeVisible();
    await expect(page.getByTestId('patient-detail-tablist')).toHaveCount(0);
    const profileJump = page.getByTestId('card-open-profile');
    await expect(profileJump).toHaveAttribute('href', '#patient-profile-summary');
    await profileJump.focus();
    await expect(profileJump).toBeFocused();

    expect(errors).toEqual([]);
  });

  test('patient MCS page surfaces setup guidance before the first sync', async ({
    context,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    const { page, errors } = await createInstrumentedPage(context);
    await openFirstPatientMcs(page);

    await expect(page.getByTestId('patient-mcs-setup-guide')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: 'URL を入力する' })).toBeVisible({
      timeout: 60_000,
    });

    expect(errors).toEqual([]);
  });

  test('prescription intake form keeps accessible labeling and keyboard flow', async ({
    context,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/prescriptions/new');

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
      '最後にこのボタンで受付を確定します',
    );

    expect(errors).toEqual([]);
  });

  test('patient mcs screen explains the first setup step when unlinked', async ({
    context,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    const { page, errors } = await createInstrumentedPage(context);
    await openFirstPatientMcs(page);

    await expect(page.locator('main').getByText('最初に必要な設定')).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator('main').getByRole('button', { name: 'URL を入力する' })).toBeVisible({
      timeout: 60_000,
    });
    expect(errors).toEqual([]);
  });

  test('patient mcs screen rejects invalid draft urls before enabling sync actions', async ({
    context,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    const { page, errors } = await createInstrumentedPage(context);
    await openFirstPatientMcs(page);

    const sourceInput = page.getByLabel('MCS 連携元 URL');
    await expect(sourceInput).toBeVisible({ timeout: 60_000 });
    await sourceInput.fill('invalid-url');

    await expect(
      page.getByText('MCS の患者 URL または医療・介護側タイムライン URL を入力してください'),
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
    await openStableRoute(page, '/prescriptions/new');

    await expect(
      page.locator('main').getByText('最後にこのボタンで受付を確定します'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: '処方受付を登録' })).toBeVisible();
    expect(errors).toEqual([]);
  });
});
