import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { Client } from 'pg';
import { PLAYWRIGHT_SCREENSHOT_DIR } from './helpers/artifacts';
import { attachLocalSession, createInstrumentedPage, openStableRoute } from './helpers/local-auth';

const DB_CONNECTION_STRING = (
  process.env.DATABASE_URL ?? 'postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public'
).replace(/\?.*$/, '');

const QR_DRAFT_REVIEW_IDS = {
  patient: 'e2e_mobile_qr_draft_patient',
  caseId: 'e2e_mobile_qr_draft_case',
  draft: 'e2e_mobile_qr_draft',
} as const;

test.setTimeout(420_000);

const MOBILE_ROUTES = [
  {
    name: 'dashboard-mobile-layout',
    path: '/dashboard',
    readyTestId: 'dashboard-cockpit',
    primaryTarget: { role: 'heading' as const, name: 'ダッシュボード', level: 1 },
  },
  {
    name: 'patients-mobile-layout',
    path: '/patients',
    readyTestId: 'patients-board',
    primaryTarget: { role: 'heading' as const, name: '患者一覧', level: 2 },
  },
  {
    name: 'reports-mobile-layout',
    path: '/reports',
    readyTestId: 'report-share-workspace',
    primaryTarget: { role: 'heading' as const, name: '報告・共有', level: 2 },
  },
  {
    name: 'workflow-mobile-layout',
    path: '/workflow',
    readyTestId: 'workflow-control-center',
    primaryTarget: { role: 'heading' as const, name: 'ワークフローダッシュボード' },
  },
  {
    name: 'billing-mobile-layout',
    path: '/billing',
    readyTestId: 'billing-check',
    primaryTarget: { role: 'heading' as const, name: '算定チェック', level: 2 },
  },
] as const;

const MOBILE_WORKFLOW_ROUTES = [
  { name: 'prescriptions-workflow-mobile-layout', path: '/prescriptions' },
  { name: 'dispensing-workflow-mobile-layout', path: '/dispensing' },
  { name: 'reports-workflow-mobile-layout', path: '/reports' },
] as const;

const MOBILE_CHROME_TOUCH_TARGET_ROUTES = [
  { name: 'dashboard-mobile-chrome-touch-targets', path: '/dashboard' },
  { name: 'patients-mobile-chrome-touch-targets', path: '/patients' },
  { name: 'reports-mobile-chrome-touch-targets', path: '/reports' },
] as const;

const MOBILE_TOUCH_TARGET_ROUTES = [
  {
    name: 'prescriptions-new-touch-targets',
    path: '/prescriptions/new',
    scope: '[data-testid="prescription-intake-form"]',
  },
  {
    name: 'qr-scan-touch-targets',
    path: '/qr-scan',
    scope: '[data-testid="qr-scan-workspace"]',
  },
  {
    name: 'reports-workspace-touch-targets',
    path: '/reports',
    scope: '[data-testid="report-share-workspace"]',
  },
  {
    name: 'reports-today-drafts-touch-targets',
    path: '/reports',
    scope: '[data-testid="report-today-drafts"]',
  },
  {
    name: 'report-detail-touch-targets',
    path: '/reports/e2e_visit_workflow_report',
    scope: '[data-testid="report-detail-workspace"]',
  },
  {
    name: 'qr-drafts-list-touch-targets',
    path: '/prescriptions/qr-drafts',
    scope: '[data-testid="qr-drafts-list-workspace"]',
  },
] as const;

const MOBILE_CROSS_SCREEN_ROUTES = [
  { name: 'dashboard-cross-screen', path: '/dashboard' },
  { name: 'my-day-cross-screen', path: '/my-day' },
  { name: 'patients-cross-screen', path: '/patients' },
  { name: 'patients-new-cross-screen', path: '/patients/new' },
  { name: 'workflow-cross-screen', path: '/workflow' },
  { name: 'prescriptions-cross-screen', path: '/prescriptions' },
  { name: 'prescriptions-new-cross-screen', path: '/prescriptions/new' },
  { name: 'qr-scan-cross-screen', path: '/qr-scan' },
  { name: 'dispensing-cross-screen', path: '/dispensing' },
  { name: 'auditing-cross-screen', path: '/auditing' },
  { name: 'medication-sets-cross-screen', path: '/medication-sets' },
  { name: 'schedules-cross-screen', path: '/schedules' },
  { name: 'schedule-proposals-cross-screen', path: '/schedules/proposals' },
  { name: 'visits-cross-screen', path: '/visits' },
  { name: 'reports-cross-screen', path: '/reports' },
  { name: 'handoff-cross-screen', path: '/handoff' },
  { name: 'conferences-cross-screen', path: '/conferences' },
  { name: 'billing-cross-screen', path: '/billing' },
  { name: 'billing-candidates-cross-screen', path: '/billing/candidates' },
  { name: 'communications-requests-cross-screen', path: '/communications/requests' },
  { name: 'notifications-cross-screen', path: '/notifications' },
  { name: 'external-cross-screen', path: '/external' },
  { name: 'settings-cross-screen', path: '/settings' },
  { name: 'admin-cross-screen', path: '/admin' },
] as const;

async function writeMobileScreenshot(page: Page, name: string) {
  await fs.mkdir(PLAYWRIGHT_SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(PLAYWRIGHT_SCREENSHOT_DIR, `${name}.png`),
    fullPage: true,
    caret: 'initial',
  });
}

async function openMobileRoute(page: Page, path: string) {
  await openStableRoute(page, path);
}

function filterExpectedMobileRouteErrors(path: string, errors: string[]) {
  if (path !== '/reports') return errors;

  return errors.filter(
    (error) =>
      !error.includes('/api/phos/report-deliveries') &&
      !error.includes('Failed to load resource: the server responded with a status of 401'),
  );
}

function assertSafeE2eDatabase() {
  if (process.env.PLAYWRIGHT !== '1' && process.env.PLAYWRIGHT_REUSE_SERVER !== '1') {
    throw new Error('Mobile UI fixtures require PLAYWRIGHT=1 or PLAYWRIGHT_REUSE_SERVER=1');
  }

  const url = new URL(DB_CONNECTION_STRING);
  const databaseName = url.pathname.replace(/^\//, '');
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname) || databaseName !== 'ph_os_e2e') {
    throw new Error('Mobile UI fixtures can only run against local ph_os_e2e');
  }
}

function jsonb(value: unknown) {
  return JSON.stringify(value);
}

async function ensureQrDraftReviewFixture() {
  assertSafeE2eDatabase();

  const client = new Client({ connectionString: DB_CONNECTION_STRING });
  await client.connect();

  try {
    const baseResult = await client.query<{
      org_id: string;
      user_id: string;
      site_id: string | null;
    }>(
      `
        SELECT u.org_id, u.id AS user_id, m.site_id
        FROM "User" u
        LEFT JOIN "Membership" m ON m.user_id = u.id AND m.org_id = u.org_id
        WHERE lower(u.email) = lower('demo@ph-os.example.com')
        ORDER BY m.created_at DESC NULLS LAST, u.created_at DESC
        LIMIT 1
      `,
    );
    const base = baseResult.rows[0];
    if (!base) throw new Error('QR draft fixture requires the local auth user');

    const siteId =
      base.site_id ??
      (
        await client.query<{ id: string }>(
          `SELECT id FROM "PharmacySite" WHERE org_id = $1 ORDER BY created_at DESC LIMIT 1`,
          [base.org_id],
        )
      ).rows[0]?.id;
    if (!siteId) throw new Error('QR draft fixture requires a pharmacy site');

    await client.query(
      `
        INSERT INTO "Patient" (
          "id","org_id","name","name_kana","birth_date","gender","created_at","updated_at"
        ) VALUES ($1,$2,'QR下書きE2E 太郎','キューアールシタガキ イーツーイー タロウ','1948-02-12','male',NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "org_id" = EXCLUDED."org_id",
            "name" = EXCLUDED."name",
            "name_kana" = EXCLUDED."name_kana",
            "birth_date" = EXCLUDED."birth_date",
            "gender" = EXCLUDED."gender",
            "updated_at" = NOW()
      `,
      [QR_DRAFT_REVIEW_IDS.patient, base.org_id],
    );

    await client.query(
      `
        INSERT INTO "CareCase" (
          "id","org_id","patient_id","status","referral_date","start_date","primary_pharmacist_id","required_visit_support","notes","created_at","updated_at"
        ) VALUES ($1,$2,$3,'active','2026-04-01','2026-04-01',$4,'{}'::jsonb,'E2E mobile QR draft review case',NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "org_id" = EXCLUDED."org_id",
            "patient_id" = EXCLUDED."patient_id",
            "status" = 'active',
            "primary_pharmacist_id" = EXCLUDED."primary_pharmacist_id",
            "required_visit_support" = EXCLUDED."required_visit_support",
            "notes" = EXCLUDED."notes",
            "updated_at" = NOW()
      `,
      [QR_DRAFT_REVIEW_IDS.caseId, base.org_id, QR_DRAFT_REVIEW_IDS.patient, base.user_id],
    );

    await client.query(
      `
        INSERT INTO "QrScanDraft" (
          "id","org_id","site_id","patient_id","scanned_by","session_id","status","schema_version",
          "raw_qr_texts","parsed_data","parse_errors","auto_completed","expected_qr_count","created_at","updated_at"
        ) VALUES ($1,$2,$3,$4,$5,'e2e-mobile-qr-draft-session','pending',1,$6::jsonb,$7::jsonb,NULL,$8::jsonb,1,NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "org_id" = EXCLUDED."org_id",
            "site_id" = EXCLUDED."site_id",
            "patient_id" = EXCLUDED."patient_id",
            "scanned_by" = EXCLUDED."scanned_by",
            "status" = 'pending',
            "raw_qr_texts" = EXCLUDED."raw_qr_texts",
            "parsed_data" = EXCLUDED."parsed_data",
            "parse_errors" = NULL,
            "auto_completed" = EXCLUDED."auto_completed",
            "expected_qr_count" = 1,
            "updated_at" = NOW()
      `,
      [
        QR_DRAFT_REVIEW_IDS.draft,
        base.org_id,
        siteId,
        QR_DRAFT_REVIEW_IDS.patient,
        base.user_id,
        jsonb(['JAHISTC08,E2E']),
        jsonb({
          patientName: 'QR下書きE2E 太郎',
          patientNameKana: 'キューアールシタガキ イーツーイー タロウ',
          patientBirthdate: '1948-02-12',
          patientGender: 'male',
          prescriptionDate: '2026-04-15',
          prescriberName: '鈴木 E2E 医師',
          prescriberInstitution: 'E2E クリニック',
          prescriberInstitutionId: null,
          lines: [
            {
              drugName: 'アムロジピン錠5mg',
              drugCode: '2171022F1020',
              dosageForm: '錠',
              dose: '1錠',
              frequency: '1日1回朝食後',
              days: 14,
              quantity: 14,
              unit: '錠',
              packagingMethod: 'unit_dose',
              packagingInstructions: '一包化',
              packagingInstructionTags: ['unit_dose'],
              route: 'internal',
              dispensingMethod: 'unit_dose',
              startDate: '2026-04-15',
              endDate: '2026-04-28',
              notes: 'E2E fixture',
            },
          ],
          supplementalRecords: [],
        }),
        jsonb([{ field: 'dosage_form', lineIndex: 0 }]),
      ],
    );
  } finally {
    await client.end();
  }
}

async function collectSmallMobileTargets(page: Page, scope: string) {
  return page.locator(scope).evaluate((root) => {
    const selector = [
      'a',
      'button',
      'input:not([type="checkbox"]):not([type="radio"]):not([type="file"])',
      'select',
      'textarea',
      '[role="button"]',
    ].join(',');

    return Array.from(root.querySelectorAll<HTMLElement>(selector))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const label =
          element.textContent?.trim().replace(/\s+/g, ' ') ||
          element.getAttribute('aria-label') ||
          element.getAttribute('placeholder') ||
          element.getAttribute('name') ||
          element.tagName.toLowerCase();

        return {
          label: label.slice(0, 80),
          tag: element.tagName.toLowerCase(),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          hiddenControl:
            element.getAttribute('aria-hidden') === 'true' ||
            (element instanceof HTMLInputElement && element.type === 'hidden') ||
            (rect.width <= 1 && rect.height <= 1 && !element.getAttribute('aria-label')),
          visible:
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== 'hidden' &&
            style.display !== 'none',
        };
      })
      .filter(
        (target) =>
          target.visible && !target.hiddenControl && (target.width < 44 || target.height < 44),
      );
  });
}

test.describe('mobile layout flow', () => {
  test.use({ viewport: { width: 393, height: 851 } });

  test.beforeEach(async ({ context }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium');
    await attachLocalSession(context);
  });

  for (const route of MOBILE_ROUTES) {
    test(`${route.path} keeps mobile-first grouping and CTA visibility`, async ({ context }) => {
      const { page, errors } = await createInstrumentedPage(
        context,
        route.path === '/reports' ? { captureHttpErrors: false } : undefined,
      );
      await openMobileRoute(page, route.path);

      await expect(page.getByTestId(route.readyTestId)).toBeVisible();
      await expect(
        page
          .getByRole(route.primaryTarget.role, {
            name: route.primaryTarget.name,
            level: 'level' in route.primaryTarget ? route.primaryTarget.level : undefined,
          })
          .first(),
      ).toBeVisible();

      const metrics = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));

      const shortcutRows = page.locator('[data-testid="page-scaffold-stack"] > *').first();
      await expect(shortcutRows).toBeVisible();

      await writeMobileScreenshot(page, route.name);
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
      expect(filterExpectedMobileRouteErrors(route.path, errors)).toEqual([]);
    });
  }

  for (const route of MOBILE_WORKFLOW_ROUTES) {
    test(`${route.path} keeps the workflow route compact on mobile`, async ({ context }) => {
      const { page, errors } = await createInstrumentedPage(
        context,
        route.path === '/reports' ? { captureHttpErrors: false } : undefined,
      );
      await openMobileRoute(page, route.path);

      const workflowNav = page.getByTestId('main-workflow-compact-nav');
      await expect(workflowNav).toBeVisible();

      const metrics = await workflowNav.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const list = element.querySelector('ol');
        return {
          height: Math.round(rect.height),
          listClientWidth: list?.clientWidth ?? 0,
          listScrollWidth: list?.scrollWidth ?? 0,
        };
      });

      expect(metrics.height).toBeLessThanOrEqual(360);
      expect(metrics.listScrollWidth).toBeGreaterThan(metrics.listClientWidth);

      await writeMobileScreenshot(page, route.name);
      expect(filterExpectedMobileRouteErrors(route.path, errors)).toEqual([]);
    });
  }

  for (const route of MOBILE_CHROME_TOUCH_TARGET_ROUTES) {
    test(`${route.name} keeps app chrome controls thumb-sized`, async ({ context }) => {
      const { page, errors } = await createInstrumentedPage(
        context,
        route.path === '/reports' ? { captureHttpErrors: false } : undefined,
      );
      await openMobileRoute(page, route.path);

      await expect(page.getByTestId('app-header')).toBeVisible();
      await expect(page.getByTestId('mobile-bottom-nav')).toBeVisible();

      const headerSmallTargets = await collectSmallMobileTargets(
        page,
        '[data-testid="app-header"]',
      );
      const bottomNavSmallTargets = await collectSmallMobileTargets(
        page,
        '[data-testid="mobile-bottom-nav"]',
      );

      await writeMobileScreenshot(page, route.name);
      expect([...headerSmallTargets, ...bottomNavSmallTargets]).toEqual([]);
      expect(filterExpectedMobileRouteErrors(route.path, errors)).toEqual([]);
    });
  }

  for (const route of MOBILE_TOUCH_TARGET_ROUTES) {
    test(`${route.name} keeps primary mobile form controls thumb-sized`, async ({ context }) => {
      const { page, errors } = await createInstrumentedPage(
        context,
        route.path === '/reports' ? { captureHttpErrors: false } : undefined,
      );
      await openMobileRoute(page, route.path);

      await expect(page.locator(route.scope)).toBeVisible({ timeout: 60_000 });
      const smallTargets = await collectSmallMobileTargets(page, route.scope);

      await writeMobileScreenshot(page, route.name);
      expect(smallTargets).toEqual([]);
      expect(filterExpectedMobileRouteErrors(route.path, errors)).toEqual([]);
    });
  }

  test('/prescriptions/qr-drafts detail keeps primary mobile controls thumb-sized when a draft exists', async ({
    context,
  }) => {
    await ensureQrDraftReviewFixture();

    const { page, errors } = await createInstrumentedPage(context);
    await openMobileRoute(page, '/prescriptions/qr-drafts');

    await openMobileRoute(page, `/prescriptions/qr-drafts/${QR_DRAFT_REVIEW_IDS.draft}`);

    await expect(page.locator('[data-testid="qr-draft-review-workspace"]')).toBeVisible({
      timeout: 60_000,
    });
    const smallTargets = await collectSmallMobileTargets(
      page,
      '[data-testid="qr-draft-review-workspace"]',
    );

    await writeMobileScreenshot(page, 'qr-draft-detail-touch-targets');
    expect(smallTargets).toEqual([]);
    expect(errors).toEqual([]);
  });

  for (const route of MOBILE_CROSS_SCREEN_ROUTES) {
    test(`${route.path} keeps cross-screen mobile shell stable`, async ({ context }) => {
      const { page, errors } = await createInstrumentedPage(
        context,
        route.path === '/reports' ? { captureHttpErrors: false } : undefined,
      );
      await openMobileRoute(page, route.path);

      const metrics = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        h1Count: document.querySelectorAll('h1').length,
      }));
      const smallTargets = await collectSmallMobileTargets(page, 'body');

      await writeMobileScreenshot(page, route.name);
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
      expect(metrics.h1Count).toBe(1);
      expect(smallTargets).toEqual([]);
      expect(filterExpectedMobileRouteErrors(route.path, errors)).toEqual([]);
    });
  }
});
