import fs from 'node:fs/promises';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { encode } from 'next-auth/jwt';
import {
  PLAYWRIGHT_ELEMENT_SCREENSHOT_DIR,
  PLAYWRIGHT_SCREENSHOT_DIR,
} from './helpers/artifacts';

const AUTH_SECRET = 'careviax-local-auth-secret';
const SCREENSHOT_DIR = PLAYWRIGHT_SCREENSHOT_DIR;
const ELEMENT_SCREEN_DIR = PLAYWRIGHT_ELEMENT_SCREENSHOT_DIR;

const LOCAL_USER = {
  id: 'cmnb3swgz0008wgq9gfpgjq6r',
  email: 'demo@careviax.example.com',
  name: '山田 太郎',
  cognitoSub: 'demo-cognito-sub-001',
  sessionVersion: 0,
};

async function createSessionToken() {
  return encode({
    secret: AUTH_SECRET,
    token: {
      userId: LOCAL_USER.id,
      email: LOCAL_USER.email,
      name: LOCAL_USER.name,
      cognitoSub: LOCAL_USER.cognitoSub,
      sessionVersion: LOCAL_USER.sessionVersion,
      sub: LOCAL_USER.cognitoSub,
    },
    maxAge: 30 * 60,
  });
}

async function attachLocalSession(context: BrowserContext) {
  const token = await createSessionToken();
  await context.addCookies([
    {
      name: 'next-auth.session-token',
      value: token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}

async function createInstrumentedPage(
  context: BrowserContext,
  options: { captureHttpErrors?: boolean } = {}
) {
  const page = await context.newPage();
  const errors: string[] = [];
  const captureHttpErrors = options.captureHttpErrors ?? true;

  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(`console:${message.text()}`);
    }
  });

  page.on('pageerror', (error) => {
    errors.push(`pageerror:${error.message}`);
  });

  if (captureHttpErrors) {
    page.on('response', (response) => {
      if (response.status() >= 400) {
        errors.push(`http:${response.status()} ${response.url()}`);
      }
    });
  }

  return { page, errors };
}

async function waitForStableUi(page: Page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => null);
}

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

async function openFirstPatientDetail(page: Page) {
  await page.goto('/patients');
  await waitForStableUi(page);

  const patientLink = page.locator('tbody tr').first().locator('a[href^="/patients/"]').first();
  const href = await patientLink.getAttribute('href');
  expect(href).toBeTruthy();
  await page.goto(href!);
  await waitForStableUi(page);
}

test.beforeEach(async ({ context }) => {
  await attachLocalSession(context);
});

test('dashboard accessibility has no critical or serious violations', async ({ context }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');

  const { page, errors } = await createInstrumentedPage(context);
  await page.goto('/dashboard');
  await waitForStableUi(page);

  const results = await new AxeBuilder({ page }).include('main').analyze();
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

  const results = await new AxeBuilder({ page }).include('main').analyze();
  const severe = results.violations.filter((violation) =>
    ['critical', 'serious'].includes(violation.impact ?? '')
  );

  const searchInput = page.getByPlaceholder('氏名・住所・担当・課題を検索');
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

  const results = await new AxeBuilder({ page }).include('main').analyze();
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

  const searchInput = page.getByPlaceholder('氏名・住所・担当・課題を検索');
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
    await expect(page.locator('main').getByText('CareViaX ダッシュボード')).toBeVisible();
    await writeScreenshot(page, 'dashboard-locale-timezone');
    expect(runtimeLocale).toBe('en-US');
    expect(runtimeTimezone).toBe('America/Los_Angeles');
    expect(errors).toEqual([]);
  });
});

test.describe('ARIA and keyboard contracts', () => {
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
            - link "スケジュール"
          - listitem:
            - link /訪問候補/
          - listitem:
            - link /処方受付/
          - listitem:
            - link /調剤/
          - listitem:
            - link /鑑査/
          - listitem:
            - link /セット管理/
          - listitem:
            - link /訪問/
          - listitem:
            - link /報告/
            - link "報告 の一覧を開く"
          - listitem:
            - link "QRスキャン"
        - paragraph: 管理
        - list:
          - listitem:
            - link "設定"
          - listitem:
            - link "文書テンプレート"
          - listitem:
            - link "マスタ"
          - listitem:
            - link "施設マスター"
          - listitem:
            - link "他職種マスター"
          - listitem:
            - link "監査ログ"
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

  test('patient detail mobile tabs keep aria structure and arrow-key navigation', async ({
    context,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');
    test.setTimeout(60_000);

    const { page, errors } = await createInstrumentedPage(context);
    await page.setViewportSize({ width: 390, height: 844 });

    await openFirstPatientDetail(page);

    const tablist = page.getByTestId('patient-detail-tablist');
    const basicTab = page.getByTestId('patient-detail-tab-basic');
    const casesTab = page.getByTestId('patient-detail-tab-cases');

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

    expect(errors).toEqual([]);
  });
});
